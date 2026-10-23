# Quickstart: Interface de git no estilo do IntelliJ

1. Crie duas pastas git com remoto `--bare` local cada uma e altere arquivos nas duas; crie um arquivo novo numa delas.
2. `npm run dev`; crie um workspace com as duas pastas.
3. Clique no ícone Commit (ou Alt+0): "Changes" mostra as duas pastas com a branch; o arquivo novo está em "Unversioned Files", desmarcado.
4. Marque um arquivo de cada pasta, clique num deles e veja o diff na área principal.
5. Escreva a mensagem e clique em "Commit": cada repositório ganha um commit.
6. Abra o menu da branch na barra superior: as duas pastas aparecem; "Push…" em cada uma pede a confirmação da main.
7. Troque de workspace no seletor: o painel e o menu acompanham. Feche e reabra o app: painel e workspace voltam.
