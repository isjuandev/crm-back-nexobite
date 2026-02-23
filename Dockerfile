# Utilizar imagen ligera de Node.js
FROM node:18-alpine

# Directorio de trabajo en el contenedor
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el código fuente y el esquema de Prisma
COPY . .

# Generar el cliente de Prisma
RUN npx prisma generate

# Exponer el puerto
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["node", "src/app.js"]
