package services

import (
	"be/config"
	"be/internal/clients/huggingface"
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
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

type DownloaderService struct {
	hub     *Hub
	baseDir string
	token   string

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

func (d *DownloaderService) Run(ctx context.Context) {
	go func() {
		for job := range d.queue {
			d.group.Go(func() error {
				d.runJob(ctx, job)
				return nil
			})
		}
	}()
}

func (d *DownloaderService) Enqueue(job DownloadJob) error {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if d.closing {
		return errors.New("service shutting down")
	}
	select {
	case d.queue <- job:
		return nil
	default:
		return errors.New("queue full")
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

	modelInfo, err := d.client.GetModelInfo(string(job.ModelVersionID))
	if err != nil {
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        err.Error(),
		})
		return
	}

	var downloadLink, basemodel, modelId string
	for _, info := range modelInfo.ModelVersions {
		if info.Id == job.ModelVersionID {
			downloadLink = info.DownloadUrl
			basemodel = info.BaseModel
			modelId = strconv.FormatInt(info.Id, 10)
		}
	}

	if downloadLink == "" {
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        "couldn't determine download link",
		})
		return
	}
	if basemodel == "" {
		d.hub.SendTo(job.ClientID, WSEvent{
			Type:           "download.failed",
			JobID:          job.JobID,
			ModelVersionID: job.ModelVersionID,
			Message:        "couldn't determine basemodel",
		})
		return
	}

	var folderPath string
	if folderPath = d.CreateFolderpath(basemodel, modelInfo.Type); folderPath == "" {
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

	if err := d.client.DownloadModelIntoFolder(modelId, folderPath); err != nil {
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

func (d *DownloaderService) CreateFolderpath(baseModel, modelType string) string {

	if modelType == "Checkpoint" {
		return fmt.Sprint("/py/models/", baseModel)
	}

	if modelType == "Loras" {
		return fmt.Sprint("/py", fmt.Sprint("/", modelType), fmt.Sprint("/", baseModel, "/"))
	}
	return ""
}
func (d *DownloaderService) CreateFolder(folderPath string) error {
	return os.MkdirAll(folderPath, 0o755)
}
