FROM node:20-slim

# Instalar dependencias necesarias para Puppeteer y Google Chrome
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Establecer la variable de entorno para que Puppeteer use el Chrome instalado
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Directorio de trabajo
WORKDIR /usr/src/app

# Copiar package.json e instalar dependencias de Node
COPY package*.json ./
RUN npm install

# Copiar el resto del código
COPY . .

# Crear el directorio temporal si no existe
RUN mkdir -p temp/capturas temp/insaco_pdfs

# Exponer el puerto
EXPOSE 3000

# Comando de inicio
CMD ["npm", "start"]
