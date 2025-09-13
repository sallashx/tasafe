# TáSafe – Gerador de Carteirinha de Emergência

![Logo TáSafe](assets/logotasafe.png)

Projeto extensionista do curso de Análise e Desenvolvimento de Sistemas.  
O TáSafe é uma aplicação web simples que gera uma **carteirinha de saúde em formato CNH (85,6 × 54 mm)**, pronta para impressão ou armazenamento digital.

## 🚀 Funcionalidades

- Preenchimento de dados pessoais:
  - Nome, SUS, data de nascimento, tipo sanguíneo
  - Alergias, condições médicas e medicamentos de uso contínuo
  - Contato de emergência
- Upload de foto
- Pré-visualização da carteirinha (frente e verso)
- Exportação em PDF (com linha de dobra)
- Identidade visual própria:
  - Verde `#249483`
  - Vermelho `#ff5757`
  - Fonte: *Roboto Slab* (logo) + *Inter* (texto)

## 🛠️ Tecnologias

- **HTML5, CSS3, JavaScript**
- **html2canvas** para geração da imagem/PDF
- GitHub Pages para hospedagem