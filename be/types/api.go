package types

type TextToImagePostRequest struct {
	PositivePrompt string `json:"positivePrompt"`
	NegativePrompt string `json:"negativePrompt"`
}

type TextToImagePostResponse struct {
	ImageBytes []byte `json:"imageBytes,omitempty"`
	MimeType   string `json:"mimeType,omitempty"`
	Filename   string `json:"filename,omitempty"`
}

type ImageToVideoPostRequest struct {
	ImageBytes     []byte `json:"imageBytes,omitempty"`
	PositivePrompt string `json:"positivePrompt"`
	NegativePrompt string `json:"negativePrompt"`
}

type ImageToVideoPostResponse struct {
	VideoBytes []byte `json:"videoBytes,omitempty"`
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
