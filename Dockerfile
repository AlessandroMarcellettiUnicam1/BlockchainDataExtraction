FROM node:22

# Install Python and build tools
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* 

WORKDIR /app
COPY . .

RUN npm install

EXPOSE 8000
CMD ["npm", "run", "start"]
