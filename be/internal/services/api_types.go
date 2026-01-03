package services

type ErrorResponse struct {
	Error string `json:"Error"`
	Message string `json:"Message"`
}

type listModelsResponse struct {
	ModelPaths []string `json:"modelPaths"`
}
type ListLorasResponse struct {
	LoraPaths []string `json:"lorapaths"`
}