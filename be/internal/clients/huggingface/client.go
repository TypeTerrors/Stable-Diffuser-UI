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
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/log"
)

type Hf struct {
	api_key    string
	httpClient *http.Client
	ctx        context.Context

	downloadUrl  string
	modelInfoUrl string
	logger       *log.Logger
}

func NewHfClient(ctx context.Context, config config.ApiDlClientConfig) *Hf {

	return &Hf{
		api_key:      config.ApiKey,
		modelInfoUrl: config.ModeInfoUrl,
		downloadUrl:  config.DownloadUrl,
		ctx:          ctx,
		logger:       log.With("component"),
		httpClient: &http.Client{
			Timeout: time.Hour,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 10 {
					return errors.New("too many redirects")
				}
				if len(via) > 0 {
					// Only forward Authorization on same-host redirects.
					// Download endpoints often redirect to a presigned S3 URL; forwarding a Bearer token to S3 can break the request.
					if strings.EqualFold(req.URL.Host, via[0].URL.Host) {
						if auth := via[0].Header.Get("Authorization"); auth != "" {
							req.Header.Set("Authorization", auth)
						}
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

	endpoint := urlWithID(hf.modelInfoUrl, id)
	hf.logger.Debug("get model info", "id", id, "url", endpoint)
	resp, err := transport.Get[ModelIdResponse](*hf.httpClient, hf.ctx, endpoint, headers)
	if err != nil {
		hf.logger.Error("get model info failed", "id", id, "err", err)
		return ModelIdResponse{}, err
	}

	return resp, nil
}

func (hf *Hf) GetModelVersionInfo(id string) (ModelVersionIdResponse, error) {

	headers := make(map[string]string)

	headers["Authorization"] = "Bearer " + hf.api_key
	headers["Content-Type"] = "application/json"

	endpoint := urlWithID(hf.modelInfoUrl, id)
	hf.logger.Debug("get model version info", "id", id, "url", endpoint)
	resp, err := transport.Get[ModelVersionIdResponse](*hf.httpClient, hf.ctx, endpoint, headers)
	if err != nil {
		hf.logger.Error("get model version info failed", "id", id, "err", err)
		return ModelVersionIdResponse{}, err
	}

	return resp, nil
}

func (hf *Hf) DownloadModelIntoFolder(modelVersionID, filePath string) error {

	headers := make(map[string]string)

	headers["Authorization"] = "Bearer " + hf.api_key

	modelVersionID = strings.TrimSpace(modelVersionID)
	if modelVersionID == "" {
		return errors.New("missing model version id")
	}
	if strings.TrimSpace(hf.downloadUrl) == "" {
		return errors.New("missing download url template")
	}

	downloadURL := urlWithID(hf.downloadUrl, modelVersionID)
	if downloadURL == "" {
		return errors.New("failed to build download url")
	}

	downloadHost := ""
	downloadPath := ""
	if u, err := url.Parse(downloadURL); err == nil && u != nil {
		downloadHost = u.Host
		downloadPath = u.Path
	}
	hf.logger.Info("download start", "host", downloadHost, "path", downloadPath, "dest", filePath)

	resp, err := transport.Download(*hf.httpClient, hf.ctx, downloadURL, headers)
	if err != nil {
		hf.logger.Error("download request failed", "host", downloadHost, "path", downloadPath, "dest", filePath, "err", err)
		return err
	}
	defer resp.Body.Close()

	filename := "model.safetensors"
	if cd := resp.Header.Get("Content-Disposition"); cd != "" {
		if fn := utils.FileNameFromCd(cd); fn != "" {
			filename = fn
		}
	}

	filename = SanitizeDownloadedFilename(filename, modelVersionID)

	tmpPath := filepath.Join(filePath, filename+".part")
	finalPath := filepath.Join(filePath, filename)

	if fi, err := os.Stat(finalPath); err == nil && fi != nil && !fi.IsDir() && fi.Size() > 0 {
		hf.logger.Info("download skipped; file exists", "file", finalPath)
		return nil
	}

	out, err := os.Create(tmpPath)
	if err != nil {
		hf.logger.Error("download create temp file failed", "tmp", tmpPath, "err", err)
		return err
	}

	_, copyErr := io.Copy(out, resp.Body)
	closeErr := out.Close()

	if copyErr != nil {
		_ = os.Remove(tmpPath)
		hf.logger.Error("download write failed", "tmp", tmpPath, "err", copyErr)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmpPath)
		hf.logger.Error("download close failed", "tmp", tmpPath, "err", closeErr)
		return closeErr
	}

	if err := os.Rename(tmpPath, finalPath); err != nil {
		_ = os.Remove(tmpPath)
		hf.logger.Error("download rename failed", "tmp", tmpPath, "final", finalPath, "err", err)
		return err
	}
	hf.logger.Info("download complete", "file", finalPath)
	return nil
}

func SanitizeDownloadedFilename(filename, modelVersionID string) string {
	modelVersionID = strings.TrimSpace(modelVersionID)
	if modelVersionID == "" {
		modelVersionID = "0"
	}

	filename = strings.TrimSpace(filename)
	if filename == "" {
		filename = "model.safetensors"
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
	if strings.HasPrefix(stem, modelVersionID+"-") {
		return stem + ext
	}
	return modelVersionID + "-" + stem + ext
}
