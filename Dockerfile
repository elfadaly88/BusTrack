# Use lightweight Alpine Node image
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Install build dependencies (needed for compilation of some native packages like sqlite3 if needed, though prebuilts usually work)
RUN apk add --no-cache python3 make g++

# Copy package config files
COPY package*.json ./

# Install dependencies (production only to keep image size small)
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose port
EXPOSE 3000

# Set environment variables default values
ENV PORT=3000
ENV NODE_ENV=production

# Command to run the server
CMD ["node", "server.js"]
