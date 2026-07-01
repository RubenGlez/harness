# Diseño: privacidad y ciclo de vida de documentos generados

> Documento de diseño. Propone una solución **standalone, agnóstica del arnés y basada
> en git** para clasificar los documentos que un flujo de trabajo genera en tres niveles
> —público, privado y efímero— y hacer cumplir esa clasificación de forma automática.
> No incluye implementación; su propósito es acordar el enfoque antes de construir.

## 1. Problema

El arnés genera documentación en `.harness/` a lo largo del flujo (`/ideate` →
`/product-plan` → `/dev-plan` → `/implement` → `/qa` → `/update-docs` → `/ship`):

| Carpeta                 | Documentos                                                              | Naturaleza                          |
|-------------------------|------------------------------------------------------------------------|-------------------------------------|
| `.harness/product/`     | `idea.md`, `product.md`, `roadmap.md`, `competitors.md`, `ux.md`, `CONTEXT.md` | Estrategia de producto              |
| `.harness/engineering/` | `architecture.md`, `implementation-plan.md`, `features/*.md`           | Ingeniería                          |
| `.harness/adr/`         | `NNNN-*.md`                                                             | Decisiones de arquitectura          |
| `.harness/qa/`          | `report.md`                                                             | Verificación (punto en el tiempo)   |
| (varios)                | PRDs / specs previas a una feature, notas de prototipo                 | Efímeros                            |

Hoy **todo `.harness/` está gitignored** (`.gitignore` + el hook `harness-gitignore.sh`,
que lo re-añade en cuanto se escribe un fichero dentro). Consecuencia: ningún documento
viaja por git. Todos son locales — ni públicos ni respaldados ni compartidos.

Eso choca con lo que se quiere, que son **tres niveles distintos**:

1. **Público** — se comparte en el repo (ingeniería, ADRs). Ayuda a colaboradores y no es sensible.
2. **Privado** — se respalda y se comparte con personas autorizadas, pero **no** es público
   (estrategia de producto: es la ventaja competitiva).
3. **Efímero** — vive solo durante el desarrollo de una unidad de trabajo. Se crea, se lee
   durante implementación/QA y se elimina (PRDs, specs previas, notas de prototipo).

### La causa raíz

Git solo modela **dos estados**: fichero rastreado (público, si el repo lo es) o ignorado
(local, nunca compartido). No existe de forma nativa un nivel "privado pero compartido" ni
un nivel "efímero con recolección automática". Toda la solución consiste en construir esos
dos niveles que faltan **encima** de git, sin depender de ningún arnés concreto.

## 2. Objetivos y no-objetivos

**Objetivos**
- Clasificar cada documento en `public | private | ephemeral` de forma declarativa.
- Hacer cumplir la clasificación automáticamente (no depender de que nadie se acuerde).
- **Fail-closed**: que sea *imposible por accidente* publicar un doc privado o commitear uno efímero.
- Agnóstico del arnés: cualquier proyecto git puede adoptarlo; el arnés solo es un consumidor más.
- Agnóstico del host: funciona igual en GitHub, GitLab o self-hosted, en repo público o privado.
- Ciclo de vida de los efímeros ligado a la unidad de trabajo natural de git: la rama/worktree.
- **Funcionar con git worktrees como caso de uso de primera clase** (agentes de codificación
  trabajando en paralelo, cada uno en su worktree/rama). Es la motivación central del diseño;
  ver §7.

**No-objetivos**
- No es un sistema de gestión documental ni un wiki. Solo clasifica y aplica políticas.
- No sustituye el control de acceso del host para el tier público; lo complementa.
- No pretende ocultar la *existencia* de documentos privados, solo su contenido (ver §5, fuga de metadatos).

## 3. Solución propuesta: una herramienta de "tiers" de documentos

Una CLI standalone (nombre de trabajo: **`doctier`**) que un proyecto instala una vez.
Se apoya en tres piezas que ya ofrece git —`.gitignore`, `.gitattributes`/filtros
clean-smudge, y hooks— orquestadas detrás de un único manifiesto de política. El arnés
(o cualquier herramienta) solo tiene que **escribir los documentos en las rutas que la
política declara**; nunca conoce a `doctier`.

### 3.1 El manifiesto de política

Un único fichero declarativo en la raíz del repo, `.doctier.yml`, versionado. Mapea
patrones glob → tier. Ejemplo con la clasificación por defecto propuesta para el arnés:

```yaml
version: 1

tiers:
  public:
    - ".harness/engineering/**"
    - ".harness/adr/**"
  private:
    - ".harness/product/**"
  ephemeral:
    - ".harness/qa/**"          # informe puntual; ver §8 (discutible)
    - ".harness/_scratch/**"    # PRDs / specs previas a una feature
    - "**/_prototype-*"         # notas de prototipo (ya se borran a mano hoy)

private:
  backend: age                  # ver §5: age | git-crypt | submodule
  recipients_file: .doctier/recipients.txt

ephemeral:
  scope: worktree               # el ciclo de vida sigue al worktree/rama (ver §7)
  collect_on: [merge, branch-delete, worktree-remove]
  ttl_days: 30                  # red de seguridad: purga por antigüedad

policy:
  uncovered: block              # doc sin tier => se bloquea el commit (fail-closed)
```

El punto clave: **cambiar el backend de privacidad no cambia cómo el arnés escribe los
docs**. El arnés escribe en `.harness/product/`; que eso acabe cifrado in-situ o en un
repo aparte es decisión de la política, no del arnés.

### 3.2 Mecanismo por tier

**Público** — sin nada especial. Git lo rastrea normalmente. Se elimina esa parte del
gitignore actual.

**Privado** — el contenido se persiste y se comparte con autorizados pero nunca se lee en
claro desde el repo público. Dos backends candidatos, comparados en detalle en §5.

**Efímero** — gitignored (nunca llega a ningún remoto), con almacenamiento ligado a la
rama y recolección automática. Detalle en §6.

### 3.3 Superficie de la CLI

| Comando                        | Qué hace                                                                       |
|--------------------------------|--------------------------------------------------------------------------------|
| `doctier init`                 | Crea `.doctier.yml`, entradas de `.gitattributes`, instala hooks, genera clave. |
| `doctier check`                | Verifica que todo doc tiene tier; que ningún privado está en claro; que ningún efímero está staged. Pensado para pre-commit/pre-push y CI. |
| `doctier gc`                   | Purga los efímeros de ramas ya fusionadas/borradas y los que superan el TTL.    |
| `doctier grant/revoke <id>`    | Gestiona el acceso privado (recipients de age / permisos del repo privado).     |
| `doctier reveal/hide`          | Descifra/cifra en local para editar (solo backend de cifrado).                  |

## 4. Redes de seguridad (fail-closed)

El fallo más grave es **commitear por accidente un doc privado en claro** (o sea,
publicarlo). El diseño lo previene con un hook `pre-commit` + `pre-push` (`doctier check`)
que **falla el commit** si:

- Hay una ruta que casa con un glob `private` staged **sin cifrar**.
- Hay una ruta `ephemeral` staged (nunca deben commitearse).
- Hay un doc **no cubierto** por ningún tier y `policy.uncovered: block` (fuerza a clasificar explícitamente).

El mismo `doctier check` corre en CI como última barrera, por si alguien tiene los hooks
desinstalados. Este comportamiento *fail-closed* es lo que hace la solución fiable: la
seguridad no depende de la memoria de nadie.

## 5. Decisión abierta: mecanismo del nivel "privado"

Aquí está la decisión que dejaste sin cerrar. Comparo las dos opciones viables y recomiendo.

### Opción A — Cifrado in-situ (age o git-crypt)

Los docs privados viven en el **mismo repo** pero cifrados. `.gitattributes` marca las
rutas privadas con un filtro `clean/smudge`: al hacer `git add` el filtro cifra (el blob
guardado es ciphertext), al hacer checkout descifra. Las claves las tienen los autorizados.

- **Pros**
  - Un solo repo. Mínima fricción operativa; nada de submódulos.
  - Agnóstico del host: funciona incluso en un repo **público** (el blob es ilegible).
  - Historia atómica: la evolución del doc privado queda versionada junto al código.
  - Onboarding = compartir/añadir una clave.
- **Contras**
  - **La historia de git es para siempre**: si una clave se filtra, quedan expuestas *todas*
    las versiones históricas. El acceso no es realmente revocable sobre el pasado.
  - Los blobs cifrados **no diffean ni mergean** bien: cada cambio reescribe el blob entero;
    los conflictos de merge son binarios y dolorosos; la historia se infla.
  - **Fuga de metadatos**: nombres de fichero, tamaños, quién editó y cuándo, y los mensajes
    de commit siguen siendo públicos. Se oculta el contenido, no la existencia ni la actividad.
  - Gestión de claves: rotación, altas/bajas de personas, custodia.
  - `age` vs `git-crypt`: `git-crypt` es llave-en-mano pero atado a GPG y con mantenimiento
    escaso; `age` (vía filtro) tiene claves modernas y multi-recipient más simples.
    Si se elige este backend → **age**.

### Opción B — Repo privado separado (submódulo o subtree)

Los docs privados viven en su **propio repo git privado**, enlazado en el árbol de trabajo
(p. ej. `.harness/product/` como submódulo, o sincronizado por subtree/`doctier`).

- **Pros**
  - Separación real: el repo público solo contiene un puntero (SHA) o nada; **cero fuga de
    contenido y de metadatos** hacia el repo público.
  - Control de acceso **nativo** del host (permisos del repo privado), y **revocable**.
  - Texto plano dentro del repo privado → `diff`, `merge` y `blame` normales.
  - Se clona y respalda de forma independiente. Sin gestión de claves criptográficas.
- **Contras**
  - **Dos repos que sincronizar.** Los submódulos son notoriamente propensos a errores
    (HEAD desacoplado, `clone --recursive`, bumps de SHA olvidados).
  - Si se referencia como submódulo desde un repo **público**, quien clona ve un submódulo
    inaccesible (puntero roto para quien no tiene permiso). Suele ser mejor mantenerlo como
    repo *hermano* sincronizado por la herramienta, no como submódulo del público.
  - Cuesta mantener atómico "código de una feature + su cambio de estrategia" (dos commits
    en dos repos).

### Recomendación

Depende del modelo de amenaza, y se reduce a **una pregunta: ¿el repo principal es público?**

- **Repo principal privado / de equipo** (caso más común aquí): el objetivo real es "no todo
  el que tiene acceso al repo debería leer la estrategia" y "que no se filtre a forks/mirrors".
  → **Cifrado in-situ con `age` (Opción A).** Menos fricción, un solo repo, agnóstico del host.
  La fuga de metadatos es aceptable dentro de un repo ya privado.

- **Repo principal público / open-source**, y no se puede filtrar ni siquiera metadatos
  → **Repo privado separado (Opción B)**, mantenido como repo hermano (no submódulo del
  público) y sincronizado por `doctier`. El acceso revocable compensa la fricción.

**El factor worktrees inclina la balanza hacia la Opción A.** Ver §7 para el detalle, pero en
resumen: los ficheros rastreados (incluidos los cifrados in-situ) **se propagan a cada worktree
automáticamente vía git**, y el filtro `smudge` los descifra en cada uno. En cambio, los
submódulos y `git worktree` tienen fricción conocida (el submódulo hay que inicializarlo por
worktree, HEAD desacoplado, etc.). Para un flujo de agentes en paralelo, "el privado viaja por
git como cualquier fichero rastreado" es una ventaja operativa grande.

**Propuesta de diseño:** hacer el backend **enchufable** detrás del manifiesto
(`private.backend: age | submodule`), con **`age` como defecto** — reforzado ahora por la
compatibilidad nativa con worktrees. Así se empieza con la opción de menor fricción y se puede
migrar a repo separado sin cambiar en absoluto cómo el arnés escribe los documentos. La
decisión no queda congelada.

> Nota de seguridad que inclina la balanza según prioridad: si lo crítico es *revocar*
> acceso a futuro y sobre el pasado, la Opción B gana (borras a alguien del repo y se acabó).
> Si lo crítico es *simplicidad operativa y un solo repo*, gana la Opción A, asumiendo que
> una clave filtrada expone la historia.

## 6. Nivel efímero: ciclo de vida ligado a la rama

Los efímeros (PRDs, specs previas, notas de prototipo) se modelan sobre la unidad de trabajo
natural de git para un flujo de agentes: el **worktree** (que casi siempre = una rama).

- **Almacenamiento**: gitignored, **por worktree** (`.harness/_scratch/` dentro de cada
  worktree, no compartido entre ellos). Al estar ignorado nunca llega a un remoto, y al ser
  local del worktree cada agente tiene los suyos sin colisionar con los de otro agente en
  paralelo. El hook `pre-commit` además impide staged accidental. Ver §7 para el matiz de que,
  al estar ignorados, no se propagan solos a un worktree nuevo.
- **Creación**: el arnés escribe el PRD ahí antes de implementar; se lee durante `/implement`
  y `/qa`.
- **Recolección** (`collect_on`): un hook `post-merge` / `post-checkout` / `post-branch-delete`
  invoca `doctier gc`, que borra los directorios efímeros cuyas ramas ya no existen o están
  fusionadas. Modela exactamente el ciclo del PRD: nace en la rama de la feature, se usa
  durante el desarrollo y **se elimina solo** al fusionar.
- **Red de seguridad**: `ttl_days` purga por antigüedad los que se quedaron huérfanos (ramas
  borradas en otra máquina, worktrees abandonados).

Esto sustituye el borrado manual que hoy hace `/prototype` ("Delete ALL prototype code") por
una recolección automática y uniforme para todos los efímeros.

## 7. Compatibilidad con worktrees (agentes en paralelo) — restricción central

Este es el motivo de ser del diseño: varios agentes de codificación trabajando **a la vez**,
cada uno en su propio `git worktree` (directorio de trabajo distinto que comparte el mismo
`.git` común). La clasificación en tiers tiene que sobrevivir a ese escenario. El
comportamiento por tier es distinto y hay que diseñarlo explícitamente.

### 7.1 Cómo se comporta cada tier en un worktree nuevo

| Tier          | ¿Se propaga solo a un worktree nuevo? | Mecanismo                                                        |
|---------------|---------------------------------------|-----------------------------------------------------------------|
| **Público**   | **Sí**, nativo                        | Son ficheros rastreados; `git worktree add` hace checkout de ellos como de cualquier otro fichero. |
| **Privado (age)** | **Sí**, nativo                    | Rastreados (cifrados). El checkout los trae y el filtro `smudge` los descifra en cada worktree. Cero infraestructura extra. |
| **Privado (repo separado)** | **No** sin trabajo extra    | Submódulos + worktrees tienen fricción: hay que `submodule update --init` por worktree; propenso a errores. |
| **Efímero**   | **No** (a propósito)                  | Gitignored → git nunca copia ignorados a un worktree nuevo. Cada worktree arranca sin efímeros, que es lo correcto: son de la unidad de trabajo. |

**La conclusión operativa clave:** con el backend de cifrado in-situ (`age`), **públicos y
privados viajan a cada worktree por el propio mecanismo de git**, sin ningún hook de
"seeding". Esto es directamente mejor que el estado actual del arnés, donde `.harness/` es
gitignored en bloque y por eso necesita `harness-seed-worktree.sh` para copiarlo a mano a cada
worktree. Al mover públicos y privados a ficheros *rastreados*, ese problema desaparece para
esos dos tiers.

### 7.2 El único caso que sigue necesitando ayuda: efímeros

Los efímeros son —y deben ser— gitignored, así que no se propagan a un worktree nuevo. Eso es
lo deseable (un worktree/rama de una feature no debería heredar los PRDs de otra). Diseño:

- **Aislamiento por worktree**: cada worktree tiene su propio `.harness/_scratch/`. Dos agentes
  en paralelo no se pisan los efímeros. No hay estado global compartido que provoque colisiones
  (encaja con el "contrato de verificación" del arnés, que ya evita servidores/puertos/fixtures
  compartidos entre worktrees).
- **Siembra opcional**: si un worktree necesita arrancar con un PRD concreto (p. ej. la feature
  a implementar), el orquestador lo pasa explícitamente o `doctier` ofrece
  `doctier scratch import <ruta>`. No se copia a ciegas todo `_scratch/` como hace hoy el hook.
- **Recolección al eliminar el worktree**: `collect_on: [..., worktree-remove]`. Como los
  efímeros viven dentro del directorio del worktree, al hacer `git worktree remove` **se van con
  él automáticamente**. `doctier gc` cubre además los worktrees abandonados (con `git worktree
  prune`) y el TTL cubre los huérfanos.

### 7.3 Consistencia de la política entre worktrees

`.doctier.yml` y `.gitattributes` están **rastreados**, así que todos los worktrees comparten
exactamente la misma política y las mismas reglas de filtro sin sincronización manual. La clave
de descifrado (`age`) es de la máquina/usuario, no del worktree: una vez configurada, sirve para
todos los worktrees de esa máquina. Los hooks de git son por-repo (viven en el `.git` común o se
instalan por worktree según config); `doctier init` los deja consistentes y `doctier check` en CI
no depende de ellos.

### 7.4 Comparación directa con el mecanismo actual del arnés

| Aspecto                          | Hoy (`.harness/` gitignored + seed hook)      | Con `doctier` (age)                          |
|----------------------------------|-----------------------------------------------|----------------------------------------------|
| Público/privado en worktree nuevo| Copiado a mano por `harness-seed-worktree.sh` | Nativo vía checkout de git                    |
| Base para reconciliar docs       | Snapshot manual `.harness/.base/`             | La propia historia de git (diff normal)       |
| Privado realmente respaldado     | No (solo local)                               | Sí (en el repo, cifrado)                       |
| Efímeros aislados por worktree   | No garantizado                                | Sí, por diseño                                |
| Colisiones entre agentes         | Posibles (todo copiado)                       | Minimizadas (rastreado = git; efímero = aislado) |

En corto: el diseño **elimina la necesidad del seed-hook para público/privado** y **formaliza**
el aislamiento y la recolección de efímeros que hoy es ad-hoc.

## 8. Clasificación por defecto propuesta (la parte que no tenías clara)

Punto de partida sugerido; ajustable en el manifiesto:

| Documento                                  | Tier propuesto | Razonamiento                                                        |
|--------------------------------------------|----------------|--------------------------------------------------------------------|
| `product/idea.md`, `product.md`, `roadmap.md`, `competitors.md`, `ux.md` | **private** | Núcleo estratégico y competitivo.                       |
| `product/CONTEXT.md` (glosario)            | **private** (discutible → público) | Es un glosario de dominio; poco sensible. Podría ser público si ayuda a colaboradores. |
| `engineering/architecture.md`, `implementation-plan.md`, `features/*.md` | **public** | Ayuda a colaboradores; no es sensible.                    |
| `adr/NNNN-*.md`                            | **public**     | Decisiones técnicas; valiosas y seguras de compartir.              |
| `qa/report.md`                             | **ephemeral** (o private) | Foto puntual de un momento; envejece rápido. Si interesa histórico → private. |
| PRD / spec previa a una feature            | **ephemeral**  | Se crea, se usa en dev/QA y se elimina.                            |
| Notas de prototipo (`_prototype-*`)        | **ephemeral**  | Hoy ya se borran a mano en `/prototype`.                           |

Matiz importante sobre las features: **la spec de ingeniería duradera** (`features/*.md`) es
pública; el **PRD transitorio** que la precede es efímero. Son dos documentos distintos con
ciclos de vida distintos, aunque hoy a veces se confundan.

Casos frontera a decidir por ti: `CONTEXT.md` (privado vs público) y `qa/report.md`
(efímero vs privado con histórico).

## 9. Integración con el arnés (como consumidor, no como dependencia)

`doctier` no conoce al arnés. La integración es mínima:

1. Enviar un `.doctier.yml` por defecto que mapee el subárbol `.harness/**` (§3.1, §8).
2. **Sustituir** el hook `harness-gitignore.sh` (que hoy ignora `.harness/` en bloque) por
   una configuración consciente de tiers: público rastreado, privado cifrado/en repo aparte,
   efímero ignorado.
3. **Retirar/aligerar** `harness-seed-worktree.sh`: público y privado ya no necesitan sembrado
   (viajan por git, §7); el hook queda —si acaso— solo para importar el efímero de arranque.
4. Opcionalmente, que `/ship` o el fin de una feature invoquen `doctier gc` (o confiar solo
   en el hook de git).

Cualquier otro proyecto git adopta la herramienta igual, sin nada del arnés.

## 10. Migración desde el estado actual

1. Añadir `.doctier.yml` clasificando los subpaths de `.harness/`.
2. Sacar del gitignore el tier público (`engineering/`, `adr/`) y empezar a rastrearlo.
3. Configurar `age` (o el repo privado) para el tier privado (`product/`) y rastrearlo cifrado.
4. Mantener el tier efímero ignorado y cablear la recolección (`doctier gc` + hooks).
5. Actualizar `harness-gitignore.sh` para delegar en `doctier` en vez de ignorar en bloque.
6. Correr `doctier check` en CI como barrera final.

Migración incremental: se puede empezar solo por el tier privado (lo más urgente) y añadir
público/efímero después.

## 11. Riesgos y mitigaciones

| Riesgo                                                   | Mitigación                                                        |
|---------------------------------------------------------|------------------------------------------------------------------|
| Publicar un privado en claro por accidente              | Hook `pre-commit`/`pre-push` fail-closed + `doctier check` en CI. |
| Hooks desinstalados en una máquina                      | `doctier check` también corre en CI (no depende del cliente).     |
| Clave filtrada (backend cifrado)                        | Rotación de claves documentada; y para el pasado, asumir exposición → usar Opción B si eso es inaceptable. |
| Submódulo desincronizado (backend repo separado)        | La CLI hace los bumps de SHA; `doctier check` avisa de desincronización. |
| Docs nuevos sin clasificar                              | `policy.uncovered: block` fuerza clasificación explícita.         |
| Efímeros huérfanos que no se recolectan                 | Red de seguridad por TTL (`ttl_days`).                            |

## 12. Preguntas abiertas para la siguiente iteración

1. **Backend privado**: ¿`age` (un repo) o repo privado separado? → §5. Recomendación: `age`
   por defecto, enchufable. **Pendiente de tu decisión final.**
2. **`CONTEXT.md`**: ¿privado o público?
3. **`qa/report.md`**: ¿efímero o privado con histórico?
4. **Alcance del efímero**: propuesto **por worktree** (§7.2), lo que encaja con agentes en
   paralelo. Confirmar si alguna vez interesa compartir un efímero entre worktrees.
5. **¿Standalone de verdad?**: confirmar que la herramienta vive en su propio repo y el arnés
   solo la consume, tal como pediste ("fuera del repo del arnés").
6. **`harness-seed-worktree.sh`**: con público/privado rastreados ya no hace falta para esos
   tiers (§7.4); confirmar si se retira del todo o se conserva solo para importar el efímero
   de arranque de cada worktree.
