<br/>
<p align="center">
  <h3 align="center">SaMathGen</h3>

  <p align="center">
    SaMathGen is NPM library that generates mathematical expressions for educational purposes.
    <br/>
    <br/>
    <a href="https://github.com/Sadykhzadeh/samathgen/issues">Report Bug</a>
    .
    <a href="https://github.com/Sadykhzadeh/samathgen/issues">Request Feature</a>
  </p>
</p>

![Downloads](https://img.shields.io/github/downloads/Sadykhzadeh/samathgen/total) ![Contributors](https://img.shields.io/github/contributors/Sadykhzadeh/samathgen?color=dark-green) ![Forks](https://img.shields.io/github/forks/Sadykhzadeh/samathgen?style=social) ![Stargazers](https://img.shields.io/github/stars/Sadykhzadeh/samathgen?style=social) ![Issues](https://img.shields.io/github/issues/Sadykhzadeh/samathgen) ![License](https://img.shields.io/github/license/Sadykhzadeh/samathgen) 

## Table Of Contents

* [About the Project](#about-the-project)
* [Built With](#built-with)
* [Getting Started](#getting-started)
  * [Prerequisites](#prerequisites)
  * [Installation](#installation)
* [Usage](#usage)
* [Contributing](#contributing)
* [License](#license)
* [Authors](#authors)
* [Acknowledgements](#acknowledgements)

## About The Project

Generating various mathematical expressions with answer options independently, for example, for primary school teachers — is a routine job. 

This library will help automate this process; it is enough to write the required arguments like expression's length, optionally brackets and other cool features.

## Built With

- [💙TypeScript](https://typescriptlang.org/)

## Getting Started

So, you need to install Node.JS and generate Node.JS project in order to use SaMathGen library

### Prerequisites

There are several ways of installing **NodeJS**:

 - [NVM](https://github.com/nvm-sh/nvm) - one of the easiest way
```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
# restart terminal (https://github.com/nvm-sh/nvm#troubleshooting-on-linux)
nvm install --lts
```
 - via [NodeSource Node.js Binary Distributions](https://github.com/nodesource/distributions/blob/master/README.md) by a package manager
 - Downloading ```tar.xz``` from [official website](https://nodejs.org/en/) 

### Installation

1. Create new Node.JS project

```sh
# works only in macOS & Linux, for Windows just create new folder and open it in cmd
mkdir new_project && cd new_project
```

2. After Installing Node.JS, initialize your Node.JS project and install SaMathGen

```sh
npm init -y && npm i samathgen
```
3. That's it! :D

## Usage

1. Create index.js(or .ts) and type this example: 

```js
const { mathGen } = require("samathgen");
console.log(mathGen(3, {
  "answer": 20,
  "brackets": false,
  "quizOptions": true
}));
```

2. Type ```node index.js``` (or .ts) in console and that's it! 🥳

```js
> node index.js                                                                                                                                    
{
  task: [ 40, '/', 4, '+', 10 ],
  answer: 2,
  quizOptions: [ 14, 17, 20, 15 ]
}
```

## Contributing

Contributions are what make the open source community such an amazing place to be learn, inspire, and create. Any contributions you make are **greatly appreciated**.
* If you have suggestions for adding or removing projects, feel free to [open an issue](https://github.com/Sadykhzadeh/samathgen/issues/new) to discuss it, or directly create a pull request after you edit the *README.md* file with necessary changes.
* Please make sure you check your spelling and grammar.
* Create individual PR for each suggestion.

### Creating A Pull Request

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

Distributed under the MIT License. See [LICENSE](https://github.com/Sadykhzadeh/samathgen/blob/main/LICENSE.md) for more information.

## Author

* **Azer Sadykhzadeh** - *CyberSecurity student in BHOS* - [🐙Sadykhzadeh](https://github.com/Sadykhzadeh/)

## Acknowledgements

* Comming soon
