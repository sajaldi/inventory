# Use official Node.js image
FROM node:18-slim

# Install system dependencies for Tesseract and OCR
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application source
COPY . .

# Expose port
EXPOSE 3001

# Command to run the application (Renamed from index.js to server.js)
CMD ["node", "server.js"]
