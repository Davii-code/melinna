# Java / Spring no Windows

A detecção Maven agora inclui **Maven: spring-boot:run** quando o pom.xml declara Spring Boot. Gradle mantém bootRun quando declara o plugin Spring Boot.

Para configurar: abra as configurações de execução, escolha a pasta Java do workspace e importe a detecção, ou crie uma configuração Maven com objetivo spring-boot:run (Gradle: bootRun). Execute a configuração salva. Argumentos como -Dspring-boot.run.profiles=dev permanecem separados dos argumentos da JVM.

No Windows, projetos com mvnw.cmd + .mvn/wrapper/maven-wrapper.jar ou gradlew.bat + gradle/wrapper/gradle-wrapper.jar podem usar o wrapper através de java.exe no PATH, sem Maven/Gradle global ou cmd.exe. As opções de JVM configuradas no Melinna e MAVEN_OPTS/GRADLE_OPTS são encaminhadas ao Java. O download da distribuição/dependências continua sendo responsabilidade do wrapper e pode requerer rede, proxy e repositórios privados.

Este caminho direto não executa customizações dos scripts batch nem lê .mvn/jvm.config automaticamente. Wrappers Maven modernos sem JAR e instalações globais que oferecem apenas mvn.cmd continuam sem suporte direto nesta alteração. O JDK deve estar no PATH do processo que inicia o Melinna; reinicie o aplicativo após alterar o ambiente.

Validação: 90 testes direcionados passaram (wrappers Java, detecção, resolução, configurações e hooks de execução), typecheck e build passaram. ESLint sem erros nos arquivos alterados; uma diretiva antiga desnecessária permanece como aviso em run-configs.ts. Nenhum serviço real foi iniciado nem banco de dados acessado durante a validação.

## Depuração da aplicação

Em configurações Maven com objetivo spring-boot:run, clique em **Ativar debug Spring (porta 5005)**, aplique e execute. Há também uma configuração detectada **Maven: Spring Boot Debug (5005)** para importar. A opção JDWP é passada à JVM da aplicação pelo spring-boot.run.jvmArguments, preservando opções já existentes. Ela escuta apenas 127.0.0.1, com suspend=y: aguarda um debugger externo (IntelliJ Remote JVM Debug, por exemplo) em localhost:5005 antes de iniciar o Spring. Remova o argumento JDWP para voltar à execução normal. Para outra porta, edite o argumento; duas aplicações precisam de portas distintas.

Para Gradle bootRun, o botão adiciona --debug-jvm. Porta e opções avançadas seguem a configuração da tarefa Gradle. Não há debugger integrado de breakpoints/variáveis no Melinna nesta entrega.

A validação atual passou 129 testes direcionados, incluindo formulários e argumentos de debug, além de typecheck e build do Melinna. ESLint passou com inline-config desabilitado para contornar uma diretiva anterior que referencia plugin ausente. Não foi realizada conexão real JDWP com IntelliJ.

## Falha real observada em webservice-integrador

A compilação offline reproduziu a falha de maven-compiler-plugin:3.8.1. O javac com os argumentos gerados revelou IllegalAccessError em lombok.javac.apt.LombokProcessor acessando JavacProcessingEnvironment. O pom declara Lombok 1.18.16 no annotationProcessorPaths e usa JDK 17. O suporte a JDK 17 foi adicionado no Lombok 1.18.22: https://projectlombok.org/changelog . A atualização deve alinhar a dependência Lombok e o annotationProcessorPaths no projeto Java; esta alteração do Melinna não editou o pom externo. Não foi declarado build Spring bem-sucedido. Os diagnósticos compilaram fontes/geraram arquivos em target, sem iniciar o Spring ou acessar bancos.
