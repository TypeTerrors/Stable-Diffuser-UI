package mediator

import (
	"be/config"
	"be/internal/dependencies"
	"be/internal/services"
	"fmt"
)

type App struct {
	api *services.Api
	rpc *dependencies.Rpc
	// settings
	Config *config.Config
}

func NewApp(config config.Config) (*App, error) {

	rpc, err := dependencies.NewRpc(config.Rpc.Peer, config.Rpc.Port)
	if err != nil {
		return nil, fmt.Errorf("error creating newapp: %w", err)
	}

	api := services.NewApi(config.Api.Port, rpc)

	return &App{
		api: api,
		rpc: rpc,
	}, nil
}

func (a *App) Start() {
	a.api.Start()
}

func (a *App) Shutdown() {
	if a.rpc != nil {
		a.rpc.Close()
	}
}
