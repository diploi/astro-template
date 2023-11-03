FROM ghcr.io/diploi/astro-template

# Install application code
WORKDIR /app
COPY . .

RUN npm install
RUN npm run build
