package services

import (
	"be/config"
	"be/internal/clients/huggingface"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

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
}

func NewDownloaderService(hub *Hub, config config.ApiDlConfig, ctx context.Context) *DownloaderService {
	s := &DownloaderService{
		hub:     hub,
		baseDir: config.BaseDir,
		queue:   make(chan DownloadJob, config.QueueSize),
		client:  huggingface.NewHfClient(ctx, config.Client),
		ctx:     ctx,
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
	d.mu.RLock()
	defer d.mu.RUnlock()
	if d.closing {
		return ErrDownloaderShuttingDown
	}
	select {
	case d.queue <- job:
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
	s.mu.Unlock()
	_ = s.group.Wait()
}

// WS only emits completion/failure.
func (d *DownloaderService) runJob(job DownloadJob) {
	if d.ctx.Err() != nil {
		return
	}

	modelVersionID := strconv.FormatInt(job.ModelVersionID, 10)
	modelInfo, err := d.client.GetModelVersionInfo(modelVersionID)
	if err != nil {
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        err.Error(),
		})
		return
	}

	downloadLink := modelInfo.DownloadUrl
	baseModel := modelInfo.BaseModel
	modelType := modelInfo.Model.Type

	if downloadLink == "" {
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        "couldn't determine download link",
		})
		return
	}
	if baseModel == "" {
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
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        "failed to create folder path",
		})
		return
	}

	if err := d.CreateFolder(folderPath); err != nil {
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        "failed to create folder path",
		})
		return
	}

	if err := d.client.DownloadModelIntoFolder(downloadLink, folderPath); err != nil {
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        err.Error(),
		})
		return
	}

	d.hub.SendTo(job.ClientID, WSEvent{
		Type:           "download.completed",
		JobID:          job.JobID,
		ModelVersionID: job.ModelVersionID,
		Message:        "download complete",
		Path:           folderPath,
	})
}

func (d *DownloaderService) createFolderpath(baseModel, modelType string) string {

	baseDir := strings.TrimSpace(d.baseDir)
	if baseDir == "" {
		return ""
	}

	baseDir = filepath.Clean(baseDir)

	modelTypeLower := strings.ToLower(strings.TrimSpace(modelType))
	typeDir := ""
	switch {
	case strings.Contains(modelTypeLower, "checkpoint"):
		typeDir = "models"
	case strings.Contains(modelTypeLower, "lora"):
		typeDir = "loras"
	default:
		return ""
	}

	// If baseDir points at one type (e.g. /workspace/models) and we're downloading the other,
	// put it in the sibling directory (/workspace/loras).
	baseName := filepath.Base(baseDir)
	if (typeDir == "loras" && strings.EqualFold(baseName, "models")) || (typeDir == "models" && strings.EqualFold(baseName, "loras")) {
		baseDir = filepath.Dir(baseDir)
	}

	if !strings.EqualFold(filepath.Base(baseDir), typeDir) {
		baseDir = filepath.Join(baseDir, typeDir)
	}

	return filepath.Join(baseDir, baseModel)
}

func (d *DownloaderService) CreateFolder(folderPath string) error {
	return os.MkdirAll(folderPath, 0o755)
}
