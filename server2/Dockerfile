# Use official Node.js image
FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application source
COPY . .

# Expose port (from .env or default 3001)
EXPOSE 3001

# Command to run the application
CMD ["node", "index.js"]
