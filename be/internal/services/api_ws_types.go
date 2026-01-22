package services

type WsPing struct {
	Ping string `json:"ping"`
}

type WsConversationResponse struct {
	Username string `json:"username"`
	Error    string `json:"error"`
	Message  []byte `json:"message"`
}
