/*
 * PaiGow 前端测试环境发布流水线。
 *
 * 这份 Jenkinsfile 参考 test-e-alpha 的前端发布口径：在 Jenkins 上完成依赖安装、
 * Vite 构建、dist 目录打包，并把静态文件发布到 nginx 节点的前端目录。
 */
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
    }

    parameters {
        string(name: 'NODE_VERSION', defaultValue: '22.22.2', description: 'Jenkins 服务器 nvm 中用于构建前端的 Node.js 版本。')
        string(name: 'NVM_SCRIPT', defaultValue: '/root/.nvm/nvm-0.38.0/nvm.sh', description: 'Jenkins 服务器上的 nvm 初始化脚本路径。')
        string(name: 'NPM_REGISTRY', defaultValue: 'https://registry.npmmirror.com', description: 'pnpm 安装依赖时使用的 npm 镜像地址。')
        string(name: 'APP_NAME', defaultValue: 'game9', description: '发布到 nginx 前端根目录下的应用目录名。')
        string(name: 'DEPLOY_NODES', defaultValue: '172.18.1.52 172.18.1.60', description: '需要同步静态文件的 nginx 节点，多个节点用空格分隔。')
        string(name: 'DEPLOY_ROOT', defaultValue: '/data/project/frontend', description: 'nginx 服务器上的前端应用根目录。')
        booleanParam(name: 'SKIP_DEPLOY', defaultValue: false, description: '只构建归档，不发布到 nginx 节点。')
    }

    environment {
        CI = 'true'
        PACKAGE_NAME = "${params.APP_NAME}.tar.gz"
    }

    stages {
        stage('拉取代码') {
            steps {
                /*
                 * Pipeline 从 GitLab 读取 Jenkinsfile 后，这里显式 checkout，
                 * 确保后续构建使用与 Jenkinsfile 相同的提交内容。
                 */
                checkout scm
            }
        }

        stage('安装依赖') {
            steps {
                sh label: '安装 pnpm 依赖', script: '''#!/usr/bin/env bash
set -euo pipefail

# 初始化 Jenkins 服务器上的 nvm，并固定使用与现有前端任务一致的 Node.js 版本。
source "${NVM_SCRIPT}"
nvm use "${NODE_VERSION}"

# 参考 test-e-alpha 的安装方式，不强制 frozen lock，避免历史锁文件与 Jenkins 环境差异阻塞发布。
pnpm install --no-frozen-lockfile --registry="${NPM_REGISTRY}"
'''
            }
        }

        stage('构建前端') {
            steps {
                sh label: '执行 Vite 构建', script: '''#!/usr/bin/env bash
set -euo pipefail

# 构建脚本内部会先执行 TypeScript 项目构建，再执行 vite build。
source "${NVM_SCRIPT}"
nvm use "${NODE_VERSION}"
pnpm build

# dist/index.html 是 nginx 单页应用入口，缺失时直接终止发布。
test -f dist/index.html
'''
            }
        }

        stage('打包产物') {
            steps {
                sh label: '归档 dist 静态文件', script: '''#!/usr/bin/env bash
set -euo pipefail

# 每次构建重新生成发布包，包内只包含 dist 的静态文件内容。
rm -f "${PACKAGE_NAME}"
tar -zcf "${PACKAGE_NAME}" -C dist .
tar -tzf "${PACKAGE_NAME}" > package-file-list.txt
grep -Eq '(^|/)index\\.html$' package-file-list.txt
'''
                archiveArtifacts artifacts: "${env.PACKAGE_NAME}", fingerprint: true, onlyIfSuccessful: true
            }
        }

        stage('发布到 nginx') {
            when {
                expression { return !params.SKIP_DEPLOY }
            }
            steps {
                sh label: '同步静态文件到 nginx 节点', script: '''#!/usr/bin/env bash
set -euo pipefail

# 仅允许发布到统一前端根目录下的子目录，避免参数误填导致清理到危险路径。
for node in ${DEPLOY_NODES}; do
  remote_dir="${DEPLOY_ROOT}/${APP_NAME}"
  remote_package="/tmp/${APP_NAME}-${BUILD_NUMBER}.tar.gz"

  case "${remote_dir}" in
    /data/project/frontend/*) ;;
    *)
      echo "非法发布目录：${remote_dir}"
      exit 10
      ;;
  esac

  echo "开始发布 ${APP_NAME} 到 ${node}:${remote_dir}"
  ssh -o StrictHostKeyChecking=no "root@${node}" "mkdir -p '${remote_dir}'"
  scp -o StrictHostKeyChecking=no "${PACKAGE_NAME}" "root@${node}:${remote_package}"
  ssh -o StrictHostKeyChecking=no "root@${node}" "set -euo pipefail; rm -rf '${remote_dir}'/*; tar -zxf '${remote_package}' -C '${remote_dir}'; chown -R nginx:root '${remote_dir}'; test -f '${remote_dir}/index.html'; rm -f '${remote_package}'"
  echo "${node} 发布完成"
done
'''
            }
        }
    }

    post {
        always {
            /*
             * Jenkins 工作区只清理构建中生成的临时产物，保留源码 checkout 由 Jenkins 自己管理。
             */
            sh label: '清理本次构建包', script: '''#!/usr/bin/env bash
rm -f "${PACKAGE_NAME}" 2>/dev/null || true
'''
        }
    }
}
