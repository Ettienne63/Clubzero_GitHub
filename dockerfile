FROM node:22

WORKDIR /app

# Add build tools + ODBC headers/libs for msnodesqlv8
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    build-essential \
    unixodbc \
    unixodbc-dev \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install

COPY . .

ENV PORT=9000

EXPOSE 9000

CMD ["npm","start"]
