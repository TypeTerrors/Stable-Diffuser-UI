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
