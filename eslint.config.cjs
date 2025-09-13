// eslint.config.cjs
const js = require("@eslint/js");
const prettier = require("eslint-config-prettier");

module.exports = [
  js.configs.recommended,
  prettier,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        // Navegador
        window: "readonly",
        document: "readonly",
        console: "readonly",
        navigator: "readonly",
        alert: "readonly",
        fetch: "readonly",
        URL: "readonly",
        File: "readonly",
        Image: "readonly",
        getComputedStyle: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",

        // Bibliotecas globais carregadas via <script>
        html2canvas: "readonly",
        jsPDF: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-constant-condition": ["warn", { checkLoops: false }],
      eqeqeq: ["error", "always"],
      "no-empty": "warn",
    },
    ignores: [
      "node_modules",
      "dist",
      "build",
      "package-lock.json"
    ]
  }
];
