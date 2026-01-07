package services

import (
	"be/config"
	"be/internal/clients/huggingface"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/charmbracelet/log"
	"golang.org/x/sync/errgroup"
)

type DownloadRequest struct {
	ClientID       string `json:"clientId"`
	ModelVersionID int64  `json:"modelVersionId"`
}

type DownloadJob struct {
	JobID          string
	ClientID       string
	ModelVersionID int64
}

var (
	ErrDownloaderShuttingDown = errors.New("service shutting down")
	ErrDownloadQueueFull      = errors.New("queue full")
)

type DownloaderService struct {
	hub     *Hub
	baseDir string

	queue chan DownloadJob
	group errgroup.Group

	mu      sync.RWMutex
	closing bool
	client  *huggingface.Hf
	ctx     context.Context
	logger  *log.Logger

	inflight map[string]string // key: clientId:modelVersionId => jobId
}

type AlreadyQueuedError struct {
	JobID string
}

func (e AlreadyQueuedError) Error() string {
	if e.JobID == "" {
		return "download already queued"
	}
	return "download already queued: " + e.JobID
}

func NewDownloaderService(hub *Hub, config config.ApiDlConfig, ctx context.Context) *DownloaderService {
	s := &DownloaderService{
		hub:      hub,
		baseDir:  config.BaseDir,
		queue:    make(chan DownloadJob, config.QueueSize),
		client:   huggingface.NewHfClient(ctx, config.Client),
		ctx:      ctx,
		logger:   log.With("component", "downloader"),
		inflight: map[string]string{},
	}
	s.group.SetLimit(config.MaxConcurrent) // battery slots
	return s
}

func (d *DownloaderService) Run() {
	go func() {
		for {
			select {
			case <-d.ctx.Done():
				return
			case job, ok := <-d.queue:
				if !ok {
					return
				}
				jobCopy := job
				d.group.Go(func() error {
					d.runJob(jobCopy)
					return nil
				})
			}
		}
	}()
}

func (d *DownloaderService) Enqueue(job DownloadJob) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closing {
		return ErrDownloaderShuttingDown
	}

	key := d.inflightKey(job.ClientID, job.ModelVersionID)
	if existing, ok := d.inflight[key]; ok {
		return AlreadyQueuedError{JobID: existing}
	}
	select {
	case d.queue <- job:
		d.inflight[key] = job.JobID
		d.logger.Debug("download enqueued", "jobId", job.JobID, "clientId", job.ClientID, "modelVersionId", job.ModelVersionID)
		return nil
	default:
		return ErrDownloadQueueFull
	}
}

func (s *DownloaderService) Shutdown() {
	s.mu.Lock()
	if !s.closing {
		s.closing = true
		close(s.queue)
	}
	s.inflight = map[string]string{}
	s.mu.Unlock()
	_ = s.group.Wait()
}

func (d *DownloaderService) inflightKey(clientID string, modelVersionID int64) string {
	return fmt.Sprintf("%s:%d", clientID, modelVersionID)
}

func (d *DownloaderService) clearInflight(job DownloadJob) {
	d.mu.Lock()
	delete(d.inflight, d.inflightKey(job.ClientID, job.ModelVersionID))
	d.mu.Unlock()
}

func preferredFilename(modelInfo huggingface.ModelVersionIdResponse) string {
	for _, f := range modelInfo.Files {
		if f.Primary && strings.TrimSpace(f.Name) != "" {
			return f.Name
		}
	}
	for _, f := range modelInfo.Files {
		if strings.TrimSpace(f.Name) != "" {
			return f.Name
		}
	}
	return ""
}

func fileExistsNonEmpty(path string) bool {
	fi, err := os.Stat(path)
	if err != nil || fi == nil {
		return false
	}
	return !fi.IsDir() && fi.Size() > 0
}

// WS only emits completion/failure.
func (d *DownloaderService) runJob(job DownloadJob) {
	defer d.clearInflight(job)
	if d.ctx.Err() != nil {
		return
	}

	d.logger.Info("download started", "jobId", job.JobID, "clientId", job.ClientID, "modelVersionId", job.ModelVersionID)

	modelVersionID := strconv.FormatInt(job.ModelVersionID, 10)
	modelInfo, err := d.client.GetModelVersionInfo(modelVersionID)
	if err != nil {
		d.logger.Error("download failed fetching model info", "jobId", job.JobID, "modelVersionId", job.ModelVersionID, "err", err)
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        err.Error(),
		})
		return
	}

	downloadLink := modelInfo.DownloadUrl
	baseModel := dashifySpaces(modelInfo.BaseModel)
	modelType := ""
	if modelInfo.Model.Type != nil {
		modelType = dashifySpaces(*modelInfo.Model.Type)
	}

	if downloadLink == "" {
		d.logger.Error("download failed missing download link", "jobId", job.JobID, "modelVersionId", job.ModelVersionID)
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        "couldn't determine download link",
		})
		return
	}
	if baseModel == "" {
		d.logger.Error("download failed missing basemodel", "jobId", job.JobID, "modelVersionId", job.ModelVersionID)
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        "couldn't determine basemodel",
		})
		return
	}

	var folderPath string
	if folderPath = d.createFolderpath(baseModel, modelType); folderPath == "" {
		d.logger.Error("download failed invalid folder path", "jobId", job.JobID, "modelVersionId", job.ModelVersionID, "baseModel", baseModel, "modelType", modelType)
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        "failed to create folder path",
		})
		return
	}

	candidate := huggingface.SanitizeDownloadedFilename(preferredFilename(modelInfo))
	finalPath := filepath.Join(folderPath, candidate)
	if fileExistsNonEmpty(finalPath) {
		d.logger.Info("download skipped; file exists", "jobId", job.JobID, "modelVersionId", job.ModelVersionID, "file", finalPath)
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.completed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        "already downloaded",
			Path:           folderPath,
		})
		return
	}

	if err := d.CreateFolder(folderPath); err != nil {
		d.logger.Error("download failed creating folder", "jobId", job.JobID, "modelVersionId", job.ModelVersionID, "folder", folderPath, "err", err)
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        "failed to create folder",
		})
		return
	}

	if err := d.client.DownloadModelIntoFolder(downloadLink, folderPath); err != nil {
		d.logger.Error("download failed downloading model", "jobId", job.JobID, "modelVersionId", job.ModelVersionID, "folder", folderPath, "err", err)
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        err.Error(),
		})
		return
	}

	d.logger.Info("download completed", "jobId", job.JobID, "modelVersionId", job.ModelVersionID, "folder", folderPath)
	d.hub.SendTo(job.ClientID, WSEvent{
		Type:           "download.completed",
		JobID:          job.JobID,
		ModelVersionID: job.ModelVersionID,
		Message:        "download complete",
		Path:           folderPath,
	})
}

func (d *DownloaderService) createFolderpath(baseModel, modelType string) string {
	baseModel = strings.TrimSpace(baseModel)
	if baseModel == "" {
		return ""
	}

	modelTypeLower := strings.ToLower(strings.TrimSpace(modelType))
	switch {
	case strings.Contains(modelTypeLower, "checkpoint"):
		modelRoot, _ := rootsFromConfig(d.baseDir)
		if strings.TrimSpace(modelRoot) == "" {
			return ""
		}
		return filepath.Join(modelRoot, baseModel)
	case strings.Contains(modelTypeLower, "lora"):
		_, loraRoot := rootsFromConfig(d.baseDir)
		if strings.TrimSpace(loraRoot) == "" {
			return ""
		}
		return filepath.Join(loraRoot, baseModel)
	default:
		return ""
	}
}

func rootsFromConfig(baseDir string) (modelRoot, loraRoot string) {
	baseDir = filepath.Clean(strings.TrimSpace(baseDir))
	if baseDir == "" {
		return "", ""
	}

	switch strings.ToLower(filepath.Base(baseDir)) {
	case "models":
		return baseDir, filepath.Join(filepath.Dir(baseDir), "loras")
	case "loras":
		return filepath.Join(filepath.Dir(baseDir), "models"), baseDir
	default:
		return filepath.Join(baseDir, "models"), filepath.Join(baseDir, "loras")
	}
}

func dashifySpaces(s string) string {
	parts := strings.Fields(strings.TrimSpace(s))
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "-")
}

func (d *DownloaderService) CreateFolder(folderPath string) error {
	return os.MkdirAll(folderPath, 0o755)
}
