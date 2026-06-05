#Orangezai Docker 安装脚本
NAME=v1.0.0 VERSION=202408090
R="[1;31m" G="[1;32m" Y="[1;33m" C="[1;36m" B="[1;m" O="[m"
echo "$B———————————————————————————
$R Orangezai$G Docker$C Script$O
    $G$NAME$C ($VERSION)$O
$B———————————————————————————

$Y- 正在检查环境$O
"
DIR="${DIR:-$HOME/Orangezai}"
CMD="${CMD:-orangezai}"
CMDPATH="${CMDPATH:-/usr/local/bin}"
DKNAME="${DKNAME:-Orangezai}"
DKURL="${DKURL:-docker.m.daocloud.io}"
GITURL="${GITURL:-https://github.com/zhiyu1998/Orangezai.git}"
APTURL="${APTURL:-mirrors.ustc.edu.cn}"
APTDEP="${APTDEP:-chromium fonts-lxgw-wenkai fonts-noto-color-emoji unzip}"
abort(){ echo "
$R! $@$O";exit 1;}
mktmp(){ TMP="$DIR/tmp"&&rm -rf "$TMP"&&mkdir -p "$TMP"||abort "缓存目录创建失败";}
if type docker;then
  echo "
$G- Docker 已安装$O
"
elif type pacman &>/dev/null;then
  echo "
$Y- 正在使用 pacman 安装 Docker$O
"
  pacman -Syu --noconfirm --needed --overwrite "*" docker||abort "Docker 安装失败"
elif type apt &>/dev/null;then
  echo "
$Y- 正在使用 apt 安装 Docker$O
"
  apt update&&apt install -y docker.io||abort "Docker 安装失败"
else
  echo "
$Y- 正在使用 官方脚本 安装 Docker$O
"
  DOWNLOAD_URL="https://$APTURL/docker-ce" bash <(curl -L get.docker.com)||abort "官方脚本 执行失败，请自行安装 Docker 后重试：https://docker.com"
fi
docker info||{ systemctl enable --now docker||service docker start&&docker info;}&&echo "
$G- Docker 已启动$O"||abort "Docker 启动失败"
N=1
until echo "
$Y- 正在从 $C$DKURL$Y 下载 Docker 容器$O
"
docker pull "$DKURL/library/node:slim";do
  echo "
$R! 下载失败，5秒后切换镜像源$O"
  sleep 5
  ((N++))
  case "$N" in
    1)DKURL="docker.m.daocloud.io";;
    2)DKURL="mirror.ccs.tencentyun.com";;
    3)DKURL="dockerpull.com";;
    4)DKURL="dockerhub.timeweb.cloud";;
    5)DKURL="mirror.baidubce.com";;
    6)DKURL="docker.nju.edu.cn";;
    7)DKURL="dockerproxy.com";;
    *)DKURL="docker.io";N=0
  esac
done
echo "
$Y- 正在构建 Docker 容器$O
"
mktmp
cd "$TMP"
echo "FROM $DKURL"'/library/node:slim
RUN sed -i "s|deb.debian.org|'"$APTURL"'|g" /etc/apt/sources.list.d/debian.sources\
 && apt update\
 && apt install -y ca-certificates\
 && sed -i "s|http://'"$APTURL"'|https://'"$APTURL"'|g" /etc/apt/sources.list.d/debian.sources\
 && apt update\
 && apt full-upgrade -y\
 && apt install -y curl git redis-server '"$APTDEP"'\
 && apt autoremove --purge\
 && apt clean\
 && git config --global --add safe.directory "*"\
 && curl -fsSL https://bun.sh/install | bash\
 && ln -sf /root/.bun/bin/bun /usr/local/bin/bun\
 && rm -rf /var/cache/* /var/log/* /var/lib/apt /root/.npm\
 && echo -n "[ -s .git ]||git clone --depth 1 --single-branch \"'"$GITURL"'\" .&&bun install&&echo -n \"exec node ./app.js pm2\">/start&&exec node ./app.js pm2">/start
HEALTHCHECK CMD curl -s http://localhost:2536/status||exit 1
WORKDIR /root/Orangezai
ENTRYPOINT []
CMD ["sh","/start"]
EXPOSE 2536'>Dockerfile
docker build -t orangezai:latest .||abort "Docker 容器构建失败"
echo "
$Y- 正在启动 Docker 容器$O
"
docker rm -f $DKNAME 2>/dev/null
docker image prune -f
docker run -itd -h Orangezai --name $DKNAME -v "$DIR":/root/Orangezai --restart always $([ $DKNAME = Orangezai ]&&echo "-p2536:2536"||echo "-P") orangezai:latest||abort "Docker 容器启动失败"
mkdir -vp "$CMDPATH"&&
echo -n 'if [ -n "$1" ];then case "$1" in
  s|start)exec docker start '$DKNAME';;
  st|stop)exec docker stop '$DKNAME';;
  rs|restart)exec docker restart '$DKNAME';;
  l|log)exec docker logs -fn"${2:-100}" '$DKNAME';;
  *)exec docker exec -it '$DKNAME' "$@";;
esac;else
  docker logs -n100 '$DKNAME'
  exec docker attach '$DKNAME'
fi'>"$CMDPATH/$CMD"&&
chmod 755 "$CMDPATH/$CMD"||abort "脚本执行命令 $CMDPATH/$CMD 设置失败，手动执行命令：docker attach $DKNAME"
echo "
$G- Docker 容器安装完成，启动命令：$C$CMD$O"
rm -rf "$TMP"
