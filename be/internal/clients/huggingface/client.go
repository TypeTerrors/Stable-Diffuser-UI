package huggingface

import (
	"be/internal/clients/transport"
	"be/utils"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type Hf struct {
	api_key    string
	httpClient *http.Client
	ctx        context.Context

	downloadUrl  string
	modelInfoUrl string
}

func NewHfClient(ctx context.Context, downloadUrl, modelInfoUrl, api_key string) *Hf {

	return &Hf{
		api_key: api_key,
		modelInfoUrl: modelInfoUrl,
		downloadUrl:  downloadUrl,
		ctx:          ctx,
		httpClient: &http.Client{
			Timeout: time.Hour,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 10 {
					return errors.New("too many redirects")
				}
				if len(via) > 0 {
					if auth := via[0].Header.Get("Authorization"); auth != "" {
						req.Header.Set("Authorization", auth)
					}
				}
				return nil
			},
		},
	}
}

func (hf *Hf) GetModelInfo(id string) (ModelIdResponse, error) {

	headers := make(map[string]string)

	headers["Authorization"] = "Bearer " + hf.api_key
	headers["Content-Type"] = "application/json"

	resp, err := transport.Get[ModelIdResponse](*hf.httpClient, hf.modelInfoUrl, headers)
	if err != nil {
		return ModelIdResponse{}, err
	}

	return resp, nil
}

func (hf *Hf) DownloadModelIntoFolder(downloadUrl, filePath string) error {

	headers := make(map[string]string)

	headers["Authorization"] = "Bearer " + hf.api_key
	resp, err := transport.Download(*hf.httpClient, hf.ctx, hf.downloadUrl, headers)
	if err != nil {
		return err
	}

	filename := "model.safetensors"
	if cd := resp.Header.Get("Content-Disposition"); cd != "" {
		if fn := utils.FileNameFromCd(cd); fn != "" {
			filename = fn
		}
	}

	tmpPath := filepath.Join(filePath, filename+".part")
	finalPath := filepath.Join(filePath, filename)

	out, err := os.Create(tmpPath)
	if err != nil {
		return err
	}

	_, copyErr := io.Copy(out, resp.Body)
	closeErr := out.Close()

	if copyErr != nil {
		_ = os.Remove(tmpPath)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmpPath)
		return closeErr
	}

	if err := os.Rename(tmpPath, finalPath); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}
