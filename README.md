# Diário de Treino

App de treino para celular (PWA) com banco no Supabase e hospedagem no GitHub Pages. Tudo no plano gratuito.

- `index.html`: o app inteiro (treino do dia, cargas por série, calendário, histórico, relógio, feedback).
- `sbdb.js`: login e acesso ao Supabase, com cópia local para abrir sem internet.
- `garmin.js`: lê ZIP, FIT e CSV do Garmin direto no navegador. A atividade vai para o dia em que aconteceu.
- `schema.sql`: tabela, regras de segurança (RLS) e visões para histórico.
- `config.js`: URL e chave pública do Supabase (a única coisa que você edita).
- `sw.js`, `manifest.webmanifest`, `icons/`: instalação na tela inicial e funcionamento offline.

## Configuração

1. **Supabase.** Crie um projeto novo (região South America). No SQL Editor, cole e rode o `schema.sql`.
2. **Usuário.** Em Authentication > Users, clique em Add user, informe e-mail e senha e marque a confirmação automática do e-mail. Depois, em Authentication > Sign In / Providers, desligue "Allow new users to sign up" para que ninguém mais consiga criar conta.
3. **Chaves.** Em Settings > API Keys, copie a Project URL e a chave pública (publishable ou anon). Nunca use a chave secreta ou `service_role` no app.
4. **Dados.** Rode no SQL Editor os arquivos `seed_1_plano_e_treinos.sql` e depois `seed_2_imagens.sql` (eles ficam fora do repositório, porque têm os seus treinos).
5. **GitHub.** Crie um repositório público, suba os arquivos desta pasta e edite o `config.js` com a URL e a chave. Em Settings > Pages, escolha Deploy from a branch, `main`, pasta `/ (root)`.
6. **Celular.** Abra o endereço do GitHub Pages. No Android (Chrome): menu > Instalar app. No iPhone (Safari): Compartilhar > Adicionar à Tela de Início. Entre uma vez com o e-mail e a senha.

## Atualizar o app

Depois de subir uma versão nova, feche e abra o app duas vezes: a primeira abertura mostra a versão guardada e baixa a nova em segundo plano. Para forçar a troca, aumente o número em `VERSION` no `sw.js`.

## Segurança

- A chave pública fica no código de propósito. O que protege os dados são as regras de RLS do `schema.sql`: cada usuário só enxerga as próprias linhas.
- O cadastro de novos usuários deve ficar desligado.
- Não coloque dados pessoais neste repositório.
