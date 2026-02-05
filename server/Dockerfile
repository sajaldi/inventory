FROM node:20-slim

# Instalar dependencias del sistema para Tesseract y OCR
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de Node
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer el puerto
EXPOSE 3001

# Comando para iniciar
CMD [ "node", "server.js" ]
