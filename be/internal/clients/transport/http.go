package transport

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func Get[r any](h http.Client, ctx context.Context, url string, headers map[string]string) (r, error) {

	var response r

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return response, err
	}

	for key, val := range headers {
		req.Header.Add(key, val)
	}

	resp, err := h.Do(req)
	if err != nil {
		return response, err
	}
	defer resp.Body.Close()

	responseBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return response, err
	}

	if err := json.Unmarshal(responseBytes, &response); err != nil {
		return response, err
	}

	return response, nil
}

func Post[b, r any](h http.Client, url string, body b, headers map[string]string) (r, error) {

	var response r

	req, err := http.NewRequest("POST", url, nil)
	if err != nil {
		return response, err
	}

	for key, val := range headers {
		req.Header.Add(key, val)
	}

	resp, err := h.Do(req)
	if err != nil {
		return response, err
	}
	defer resp.Body.Close()

	responseBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return response, err
	}

	if err := json.Unmarshal(responseBytes, &response); err != nil {
		return response, err
	}

	return response, nil
}

func Download(h http.Client, ctx context.Context, url string, headers map[string]string) (*http.Response, error) {

	var resp *http.Response

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return resp, err
	}

	resp, err = h.Do(req)
	if err != nil {
		return resp, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		_ = resp.Body.Close()
		return resp, fmt.Errorf("download failed: %s: %s", resp.Status, strings.TrimSpace(string(snippet)))
	}

	return resp, nil
}
