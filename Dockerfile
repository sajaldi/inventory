# Use official Node.js image (match server/Dockerfile)
FROM node:18-slim

# Install system dependencies for Tesseract
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package files from server folder
COPY server/package*.json ./

# Install dependencies
RUN npm install --production

# Copy server source code only
COPY server/ .

# Expose port
EXPOSE 3001

# Start the server
CMD [ "node", "server.js" ]
