FROM node:22

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npx prisma generate

ENV PORT=9000

EXPOSE 9000

CMD ["npm","start"]
