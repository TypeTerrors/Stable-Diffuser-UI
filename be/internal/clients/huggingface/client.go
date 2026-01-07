package huggingface

import (
	"be/config"
	"be/internal/clients/transport"
	"be/utils"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Hf struct {
	api_key    string
	httpClient *http.Client
	ctx        context.Context

	downloadUrl  string
	modelInfoUrl string
}

func NewHfClient(ctx context.Context, config config.ApiDlClientConfig) *Hf {

	return &Hf{
		api_key:      config.ApiKey,
		modelInfoUrl: config.ModeInfoUrl,
		downloadUrl:  config.DownloadUrl,
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

func urlWithID(template, id string) string {
	template = strings.TrimSpace(template)
	if template == "" {
		return ""
	}
	if strings.Contains(template, "{id}") {
		return strings.ReplaceAll(template, "{id}", id)
	}
	if strings.Contains(template, "%s") {
		// Allows config like: "https://.../%s"
		return fmt.Sprintf(template, id)
	}
	if strings.HasSuffix(template, "/") {
		return template + id
	}
	return template + "/" + id
}

func (hf *Hf) GetModelInfo(id string) (ModelIdResponse, error) {

	headers := make(map[string]string)

	headers["Authorization"] = "Bearer " + hf.api_key
	headers["Content-Type"] = "application/json"

	url := urlWithID(hf.modelInfoUrl, id)
	resp, err := transport.Get[ModelIdResponse](*hf.httpClient, hf.ctx, url, headers)
	if err != nil {
		return ModelIdResponse{}, err
	}

	return resp, nil
}

func (hf *Hf) GetModelVersionInfo(id string) (ModelVersionIdResponse, error) {

	headers := make(map[string]string)

	headers["Authorization"] = "Bearer " + hf.api_key
	headers["Content-Type"] = "application/json"

	url := urlWithID(hf.modelInfoUrl, id)
	resp, err := transport.Get[ModelVersionIdResponse](*hf.httpClient, hf.ctx, url, headers)
	if err != nil {
		return ModelVersionIdResponse{}, err
	}

	return resp, nil
}

func (hf *Hf) DownloadModelIntoFolder(downloadURLOrID, filePath string) error {

	headers := make(map[string]string)

	headers["Authorization"] = "Bearer " + hf.api_key

	downloadURL := strings.TrimSpace(downloadURLOrID)
	if downloadURL == "" {
		return errors.New("missing download url")
	}
	if !strings.HasPrefix(downloadURL, "http://") && !strings.HasPrefix(downloadURL, "https://") && hf.downloadUrl != "" {
		downloadURL = urlWithID(hf.downloadUrl, downloadURL)
	}

	resp, err := transport.Download(*hf.httpClient, hf.ctx, downloadURL, headers)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	filename := "model.safetensors"
	if cd := resp.Header.Get("Content-Disposition"); cd != "" {
		if fn := utils.FileNameFromCd(cd); fn != "" {
			filename = fn
		}
	}

	filename = sanitizeDownloadedFilename(filename)

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

func sanitizeDownloadedFilename(filename string) string {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return "model.safetensors"
	}

	// Prevent any path traversal / nested paths from the server.
	filename = filepath.Base(filename)

	ext := filepath.Ext(filename)
	stem := strings.TrimSuffix(filename, ext)
	if ext == "" {
		ext = ".safetensors"
	}

	// Requirements: no spaces or periods in the stem.
	stem = strings.Join(strings.Fields(stem), "-")
	stem = strings.ReplaceAll(stem, ".", "-")
	stem = strings.Trim(stem, "-")
	if stem == "" {
		stem = "model"
	}

	ext = strings.ReplaceAll(ext, " ", "")
	return stem + ext
}
