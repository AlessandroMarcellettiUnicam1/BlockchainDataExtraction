FROM node:22-alpine

# Install Python and build tools
RUN apk add --no-cache python3 make g++ 

WORKDIR /app
COPY . .

RUN npm install

EXPOSE 8000
CMD ["npm", "run", "start"]
