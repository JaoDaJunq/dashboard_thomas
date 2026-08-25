# dashboard_thomas

Dashboard estático para monitoramento de consumo da Crescer Automação.

## Arquitetura

O projeto foi feito para funcionar somente com GitHub Pages:

`ESP → Google Sheets → GitHub Pages`

Não há backend próprio, servidor Node, banco adicional ou etapa de build.

## Fonte de dados

O dashboard lê a aba `gid=0` da planilha Google Sheets configurada em `app.js` usando a saída CSV do Google Visualization.

A leitura atual considera válidas as linhas que obedecem ao padrão do projeto:

- 1 pulso = 10 litros
- 1 pulso = R$ 5,30

Linhas antigas de teste que não obedecem a esse padrão são ignoradas automaticamente.

## GitHub Pages

Ative em:

1. Settings
2. Pages
3. Source: Deploy from a branch
4. Branch: `main`
5. Folder: `/ (root)`
6. Save

Depois disso o site deve ficar disponível em:

`https://jaodajunq.github.io/dashboard_thomas/`

## Arquivos

- `index.html`: interface
- `styles.css`: visual responsivo
- `app.js`: leitura da planilha, validação, filtros, cálculos e gráfico

## Observação importante

Para a leitura direta funcionar no navegador, a planilha precisa permitir acesso público de leitura ou estar publicada de forma compatível com a saída CSV do Google Sheets.
