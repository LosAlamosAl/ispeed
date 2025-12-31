FROM debian:trixie

# Had to update certificates--git https clone was failing
RUN apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        adduser                                   \
        bash                                      \
        file                                      \
        zsh                                       \
        zip                                       \
        unzip                                     \
        less                                      \
        httpie                                    \
        curl                                      \
        git                                       \
        jq                                        \
        htop                                      \
        man-db                                    \
        gnupg2                                    \
        ssh                                       \
        make                                      \
        groff                                     \
        python3                                   \
        python3-pip                               \
        python3-setuptools                        \
        python3-venv                              \
        # needed (temporarily) to install node-canvas from source (no ARM binary)
        # only used locally--lambda layer used by lambda function
        build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
        openssh-client ca-certificates \
    && update-ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN adduser --home /home/devboy --shell /usr/bin/zsh --no-create-home devboy \
    && usermod -aG sudo devboy \
    && mkdir /home/devboy \
    && chown devboy /home/devboy \
    && chgrp devboy /home/devboy

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs

RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o awscliv2.zip \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip

# This no longer works because modern Python installations don't
# want you to install packages willy-nilly into the system Python.
# So we create a virtual environment later and install cfn-lint there.
#RUN pip3 install cfn-lint

RUN npm install -g aws-cdk@latest
RUN npm install -g @anthropic-ai/claude-code

USER devboy
WORKDIR /home/devboy

RUN python3 -m venv ~/.venv  \
    && ~/.venv/bin/pip install --upgrade cfn-lint

RUN zsh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)" || true
RUN git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k

# Oh My ZSH installs a .zshrc. Remove so we can overwrite it when cloning dotfiles.
RUN rm ~/.zshrc
