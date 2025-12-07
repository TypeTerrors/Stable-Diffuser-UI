package services

import (
	"be/internal/dependencies"
	"fmt"

	"github.com/charmbracelet/log"
	"github.com/gofiber/fiber/v2"
)

type Api struct {
	server *fiber.App
	rpc    *dependencies.Rpc
	port   string
}

func NewApi(port string, rpc *dependencies.Rpc) *Api {
	return &Api{
		server: fiber.New(),
		rpc:    rpc,
		port:   port,
	}
}

func (a *Api) Start() {

	a.addRoutes()

	log.Fatal(a.server.Listen(fmt.Sprint(":", a.port)))
}

func (a *Api) addRoutes() {
	a.server.Add("GET", "/health", a.Health())
	a.server.Add("POST", "/generateimage", a.GenerateImage())
}
