package types

type ImagePostRequest struct {
	PositivePrompt string `json:"positivePrompt"`
	NegativePrompt string `json:"negativePrompt"`
}

type SetModelRequest struct {
	ModelPath string `json:"modelPath"`
}

type SetModelResponse struct {
	ModelPath string `json:"modelPath"`
}

type CurrentModelResponse struct {
	ModelPath string `json:"modelPath"`
}

type ClearModelResponse struct {
	ModelPath string    `json:"modelPath"`
	Loras     []SetLora `json:"loras"`
}

type SetLora struct {
	Weight float32 `json:"weight"`
	Path   string  `json:"path"`
}

type ImagePostResponse struct {
	ImageBytes []byte `json:"imageBytes,omitempty"`
	MimeType   string `json:"mimeType,omitempty"`
	Filename   string `json:"filename,omitempty"`
}

type ErrorResponse struct {
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

type HealthResponse struct {
	Status    int   `json:"status"`
	TimeStamp int64 `json:"timestamp"`
}

type listModelsResponse struct {
	ModelPaths []string `json:"modelPaths"`
}

type ListLorasResponse struct {
	LoraPaths []string `json:"lorapaths"`
}

type DownloadResponse struct {
	JobID string `json:"jobId"`
}
