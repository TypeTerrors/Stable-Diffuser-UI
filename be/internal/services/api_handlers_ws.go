package services

import (
	"strings"

	"github.com/charmbracelet/log"
	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
)

func (a *Api) Notifications() fiber.Handler {
	return websocket.New(func(conn *websocket.Conn) {

		clientId := strings.TrimSpace(conn.Params("id"))
		if clientId == "" {
			clientId = strings.TrimSpace(conn.Query("clientId"))
		}
		if clientId == "" {
			conn.WriteMessage(websocket.CloseMessage, []byte("missing clientId"))
			conn.Close()
			return
		}

		log.Info("ws connected", "component", "ws", "clientId", clientId)

		c := &WSClient{
			id:   clientId,
			conn: conn,
			send: make(chan []byte, 16),
		}

		if a.hub != nil {
			a.hub.Add(c)
		}

		go c.writeLoop()
		c.readLoop(func() {
			if a.hub != nil {
				a.hub.Remove(clientId)
			}
			log.Info("ws disconnected", "component", "ws", "clientId", clientId)
		})
	})
}

func (a *Api) WsConverstation() fiber.Handler {
	return websocket.New(func(conn *websocket.Conn) {

		userName := strings.TrimSpace(conn.Params("userName"))
		if userName == "" {
			userName = strings.TrimSpace(conn.Query("userName"))
		}

		if userName == "" {
			conn.WriteJSON(WsConversationResponse{
				Error: "missing usernanme",
			})
			conn.Close()
			return
		}

		if err := a.ConversationManager.RegisterClient(userName, conn); err != nil {
			conn.WriteJSON(WsConversationResponse{
				Error: err.Error(),
			})
			conn.Close()
			return
		}

		defer func() {
			a.ConversationManager.RemoveClient(userName)
			_ = conn.Close()
			log.Info("ws disconnected", "component", "conversation", "userName", userName)
		}()

		log.Info("ws connected", "component", "conversation", "userName", userName)

		for {
			// Block until the client disconnects (or sends a close frame).
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	})
}
