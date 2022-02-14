<p align="center">
  <h2 align="center" style="font-size:2em;">SaMathGen</h2>
  <p align="center" style="font-size:1.4em;">
    NPM library that generates math expressions for education purposes.
    <br/>
    You can <a href="https://github.com/Sadykhzadeh/samathgen/issues">report bug</a>
    or
    <a href="https://github.com/Sadykhzadeh/samathgen/issues">request feature 👀</a>
  </p>
  <p align="center">
  <img alt="Stargazers" src="https://img.shields.io/github/stars/Sadykhzadeh/samathgen?style=social"/>
<img alt="Forks" src="https://img.shields.io/github/forks/Sadykhzadeh/samathgen?style=social"/>
<img alt="Issues" src="https://img.shields.io/github/issues/Sadykhzadeh/samathgen?style=social"/>
<img alt="License" src="https://img.shields.io/github/license/Sadykhzadeh/samathgen?style=social"/>
</p>
</p>

## Table Of Contents

- [About The Library](#about-the-library)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Usage](#usage)
- [Contributing](#contributing)
- [License](#license)

## About The Library

Generating various math expressions independently, for example, for primary school educators — is a routine job.

This library can help you automate this process; it is enough to write the required arguments like expression's size, optionally brackets and other cool features.

There are **no dependencies** in this library, except **[💙TypeScript](https://typescriptlang.org/)**.

With 💚 by **Azer Sadykhzadeh** — [🐙 GitHub](https://github.com/Sadykhzadeh/)

## Getting Started

So, you need to install Node.JS and generate Node.JS project in order to use SaMathGen library.

### Prerequisites

<details>
<summary>Prerequisites</summary>
There are several ways of installing Node.JS:

- [💙NVM](https://github.com/nvm-sh/nvm) - one of the easiest way

```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
# restart terminal (https://github.com/nvm-sh/nvm#troubleshooting-on-linux)
nvm install --lts
```

- via [NodeSource Node.js Binary Distributions](https://github.com/nodesource/distributions/blob/master/README.md) by a package manager
- Downloading `tar.xz` from [official website](https://nodejs.org/en/)
</details>

### Installation

1. Create new Node.JS project

```sh
# works only in macOS & Linux
mkdir new_project && cd new_project
# for Windows just create new folder and open it in cmd

npm init -y
```

2. Install SaMathGen

```sh
npm install samathgen
```

3. That's it! ^\_^

## Usage

1. Create index.js(or .ts) and type this example:

```js
const { mathGen } = require("samathgen");
const expression = mathGen(3, {
  "answer": 40,
  "brackets": false,
  "quizOptions": true
});
console.log(expression);
```

2. Type `node index.js` (or .ts) in console and check output! 🥳

```bash
> node index.js
{
  task: [ 100, '/', 5, '+', 20 ],
  answer: 40,
  quizOptions: [ 41, 40, 38, 30 ]
}
```

## Contributing

Contributions are what make the open source community such an amazing place to be learn, inspire, and create.

Any contributions you make are **greatly appreciated**.

- If you have suggestions for adding or removing projects, feel free to [open an issue](https://github.com/Sadykhzadeh/samathgen/issues/new) to discuss it, or directly create a pull request after you edit the _README.md_ file with necessary changes.
- Please make sure you check your spelling and grammar.
- Create individual PR for each suggestion.
- Please make sure your pull request is **not** a duplicate of an existing issue.

### Creating A Pull Request

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

Distributed under GNU General Public License v3.0. See [LICENSE](https://github.com/Sadykhzadeh/samathgen/blob/master/LICENSE) for more information.
