# 涂鸦街区 (Doodle District) - 静态站点 Dockerfile
FROM nginx:1.27-alpine

# 站点文件复制到 nginx 默认站点目录
COPY . /usr/share/nginx/html

# 静态资源缓存策略：vendor 下的是不可变库文件，长缓存；其余短缓存
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    gzip on;\n\
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;\n\
    location = /api/turn-credentials {\n\
        proxy_pass http://turn-api:3000;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;\n\
        add_header Cache-Control "no-store" always;\n\
    }\n\
    location /vendor/ {\n\
        expires 30d;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
