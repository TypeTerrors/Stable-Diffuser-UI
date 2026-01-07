package huggingface

import (
	"encoding/json"
	"time"
)

type ModelIdResponse struct {
	Id            int64  `json:"id"`
	Name          string `json:"name"`
	Type          string `json:"type"`
	ModelVersions []struct {
		Id           int64    `json:"id"`
		Name         string   `json:"name"`
		Description  string   `json:"description"`
		DownloadUrl  string   `json:"downloadUrl"`
		TrainedWords []string `json:"trainedWords"`
		BaseModel    string   `json:"baseModel"`
	} `json:"modelVersions"`
}

type ModelVersionIdResponse struct {
	Id                   int64               `json:"id"`
	ModelId              int64               `json:"modelId"`
	Name                 string              `json:"name"`
	CreatedAt            time.Time           `json:"createdAt"`
	UpdatedAt            time.Time           `json:"updatedAt"`
	TrainedWords         []string            `json:"trainedWords"`
	BaseModel            string              `json:"baseModel"`
	EarlyAccessTimeFrame int64               `json:"earlyAccessTimeFrame"`
	Description          *string             `json:"description"`
	Stats                ModelVersionStats   `json:"stats"`
	Model                ModelVersionModel   `json:"model"`
	Files                []ModelVersionFile  `json:"files"`
	Images               []ModelVersionImage `json:"images"`
	DownloadUrl          string              `json:"downloadUrl"`
}

type ModelVersionStats struct {
	DownloadCount int64   `json:"downloadCount"`
	RatingCount   int64   `json:"ratingCount"`
	Rating        float64 `json:"rating"`
}

type ModelVersionModel struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Nsfw bool   `json:"nsfw"`
	Poi  bool   `json:"poi"`
}

type ModelVersionFile struct {
	Name              string                   `json:"name"`
	Id                int64                    `json:"id"`
	SizeKB            float64                  `json:"sizeKB"`
	Type              string                   `json:"type"`
	Metadata          ModelVersionFileMetadata `json:"metadata"`
	PickleScanResult  string                   `json:"pickleScanResult"`
	PickleScanMessage string                   `json:"pickleScanMessage"`
	VirusScanResult   string                   `json:"virusScanResult"`
	ScannedAt         time.Time                `json:"scannedAt"`
	Hashes            ModelVersionFileHashes   `json:"hashes"`
	Primary           bool                     `json:"primary"`
	DownloadUrl       string                   `json:"downloadUrl"`
}

type ModelVersionFileMetadata struct {
	Fp     string `json:"fp"`
	Size   string `json:"size"`
	Format string `json:"format"`
}

type ModelVersionFileHashes struct {
	AutoV1 string `json:"AutoV1"`
	AutoV2 string `json:"AutoV2"`
	SHA256 string `json:"SHA256"`
	CRC32  string `json:"CRC32"`
	BLAKE3 string `json:"BLAKE3"`
}

type ModelVersionImage struct {
	Url    string          `json:"url"`
	Nsfw   bool            `json:"nsfw"`
	Width  int64           `json:"width"`
	Height int64           `json:"height"`
	Hash   string          `json:"hash"`
	Meta   json.RawMessage `json:"meta"`
}
