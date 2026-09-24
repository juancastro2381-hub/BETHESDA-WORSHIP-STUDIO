# WORSHIP STUDIO
## Propuesta de Alcance, Funcionalidades y Evolución del Proyecto
### Documento para revisión y validación de usuarios

**Documento:** Worship Studio — Documento de Alcance y Acuerdos  
**Versión:** 1.2 — Documento revisado para validación de usuarios  
**Fecha:** Septiembre 2026  
**Estado:** BORRADOR PARA REVISIÓN DE USUARIOS  
**Destinatarios:** músicos, cantantes y coordinadores.  

---

## 1. Portada y Presentación

Bienvenido a la propuesta de alcance y definición de **Worship Studio**.

El propósito de este texto es presentar de manera clara, transparente y sin tecnicismos qué es Worship Studio, cuál es el alcance general del proyecto, qué capacidades se encuentran actualmente en desarrollo, qué funciones están contempladas para su implementación y cuáles son las ideas propuestas para etapas futuras.

Este documento tiene como fin servir como una **herramienta de diálogo y entendimiento compartido**. Su lectura y retroalimentación permitirán definir con precisión qué funciones son prioritarias, cuáles requieren ajustes y cuáles deben formar parte de la próxima etapa de trabajo.

---

## 2. ¿Qué contempla Worship Studio?

Worship Studio reúne estos elementos en un espacio integral de trabajo que contempla:

- **Biblioteca central de canciones:** Registro ordenado de canciones con su autor, compás, tempo sugerido y estructura de estrofas y coros.
- **Notación musical y partituras:** Representación visual de notas musicales para quienes leen pentagrama tradicional.
- **Cifrado armónico y acordes:** Visualización clara de los nombres de los acordes ubicados sobre cada línea de la letra.
- **Letras completas:** Letras organizadas por secciones (Introducción, Estrofa, Coro, Puente, Final).
- **Adaptación por instrumento:** Posibilidad de que cada integrante consulte la canción en el formato más adecuado para su instrumento (piano, guitarra, saxofón, voz, bajo, etc.).
- **Tonalidades y transposición:** Capacidad de ajustar la tonalidad de visualización de una canción para adaptarla a la voz de quien canta, sin alterar el registro maestro original.
- **Orden del servicio y repertorios (Setlists):** Organización secuencial de las canciones y actividades programadas para una reunión o servicio.
- **Momentos del servicio:** Integración de actividades no cantadas (bienvenidas, oraciones, lecturas, ofrendas, predicación) dentro de la misma lista de culto.
- **Atril digital de escenario:** Interfaz de lectura diseñada para visualizar el repertorio en tablets, teléfonos o computadores, con controles para avanzar o retroceder.
- **Herramientas de preparación y ensayo:** Funciones proyectadas para practicar temas, estudiar pasajes y coordinar el repertorio con anticipación.
- **Sincronización del equipo:** Visión para que los dispositivos de los músicos puedan conectarse entre sí y seguir las indicaciones durante la ejecución.


---

## 3. ¿Qué ya está en desarrollo?

En esta sección se presentan las capacidades que actualmente forman parte del desarrollo de Worship Studio:

### 3.1 Biblioteca central de canciones
- **Catálogo de temas:** Organización de canciones con su título, autor o artista, compás (ej. 4/4, 6/8), tempo sugerido (pulsaciones por minuto) y tonalidad de referencia.
- **Preservación musical:** Conservación rigurosa de compases, figuras, notas, acordes y letras de cada tema.
- **Manejo de versiones:** Capacidad de registrar arreglos o variantes de una canción sin sobreescribir la versión principal.

### 3.2 Diferentes formas de visualizar una canción
Una misma canción en el sistema puede presentarse en diversos formatos según las necesidades del músico:
- **Pentagrama clásico:** Con notas musicales en clave de Sol o clave de Fa para pianistas e instrumentistas melódicos.
- **Tablatura para guitarra:** Con representación gráfica de cuerdas y trastes.
- **Cifrado armónico sobre la letra:** Visualización de los acordes situados exactamente sobre la sílaba o palabra correspondiente.
- **Letra sola:** Formato limpio y en tamaño destacado para vocalistas.
- **Marcadores de secciones:** Indicadores claros de Introducción, Estrofa, Pre-coro, Coro, Puente, Solo o Final.
- **Vistas por instrumento:** Adaptación visual orientada a piano, guitarra, saxofón o voz principal.

### 3.3 Cambio de tono (Transposición)
- **Cálculo dinámico:** Una canción puede presentarse en cualquier tonalidad sin necesidad de modificar el registro original.
- **Ejemplo:** Si una canción fue registrada originalmente en *Sol mayor* pero se requiere interpretarla en *Si bemol mayor*, el usuario selecciona la nueva tonalidad y Worship Studio recalcula los acordes y notas en pantalla.
- **Conservación de la fuente:** El tono base de la canción permanece inalterado en la biblioteca general; la transposición se aplica a la vista específica requerida.

### 3.4 Indicador de cejuela (Capo) para guitarristas
- Para los guitarristas que emplean cejuela en el mástil para tocar con digitaciones abiertas mientras suena la tonalidad de la banda, el sistema calcula e indica la posición correspondiente.

### 3.5 Importación de canciones
El desarrollo contempla la incorporación de canciones a partir de formatos digitales estándar:
1. **Archivos MusicXML:** Formato estándar utilizado por programas de partituras.
2. **Archivos ChordPro:** Formato de texto con acordes entre corchetes dentro de la letra (ejemplo: `[Sol]Cuan grande es [Re]Dios`).

*(Nota: Esta vía no contempla en esta etapa la importación desde archivos MIDI, documentos PDF escaneados ni grabaciones de audio).*

### 3.6 Gestión de repertorios de culto (Setlists)
- **Programación de reuniones:** Creación de listas para servicios o eventos con fecha, nombre y notas de guía.
- **Selección de canciones:** Incorporación ágil de temas desde la biblioteca.
- **Tonalidad por servicio:** Asignación del tono específico en que se interpretará cada tema en dicha reunión.
- **Inclusión de momentos del servicio:** Registro de actividades no cantadas dentro de la secuencia.
- **Reordenamiento:** Botones táctiles para subir (`▲`) o bajar (`▼`) elementos en la lista para ajustar el orden.
- **Edición controlada:** Modificación de datos del culto y administración de elementos según los permisos asignados.
- **Repertorio activo:** Regla de gestión que mantiene un único repertorio en estado activo para orientar al equipo.

### 3.7 Momentos del servicio integrados
- Registro de momentos no musicales (bienvenida, oración, lectura bíblica, ofrenda, anuncios, predicación, ministración con música de fondo) con su título y notas de orientación.
- En el atril digital, estos momentos se presentan mediante una tarjeta informativa con sus indicaciones, integrándose naturalmente a la secuencia del servicio.

### 3.8 Atril digital de escenario
- **Visualización de alto contraste:** Diseño visual concebido para condiciones de iluminación en escenarios y templos.
- **Navegación entre elementos:** Botones táctiles (`[◄ Anterior]` y `[Siguiente ►]`) para avanzar o retroceder entre temas y momentos.
- **Aviso del siguiente elemento:** Indicación permanente de la canción en curso y de la que viene a continuación.
- **Opción de retorno al culto:** Posibilidad de consultar temporalmente un tema fuera de lista y regresar con un solo toque (`[ Volver al Culto ]`) a la posición en que se encontraba la reunión.
- **Ajuste de tono en pantalla:** Control para cambiar la tonalidad de visualización directamente durante el uso del atril.

### 3.9 Control de accesos y seguridad
- Esquema de permisos diferenciados para que los integrantes consulten los repertorios sin riesgo de alterar accidentalmente la programación, reservando las opciones de edición para los coordinadores autorizados.
- Acceso individual mediante usuario y contraseña.

---

## 4. Funciones contempladas para implementación

En esta sección se presentan aquellas capacidades contempladas como parte de la evolución de Worship Studio. Estas funciones se someten a la consideración del equipo para su revisión y priorización:

### 4.1 Herramientas para la práctica y el ensayo
- **Metrónomo digital integrado:** Emisión audible del pulso rítmico dentro de la aplicación.
- **Cuenta de entrada:** Señal visual o acústica previa al inicio de una canción (ej. cuenta de 4 tiempos).
- **Repetición en bucle de secciones:** Selección de un grupo específico de compases para repetirlos de manera continua durante el estudio de pasajes complejos.
- **Variación de velocidad de práctica:** Opción de reproducir o marcar el tempo a velocidad reducida e incrementarla progresivamente.
- **Pistas de audio de referencia y multitracks:** Reproducción de grabaciones guía y posibilidad de escuchar pistas separadas por instrumento para ensayo individual.

### 4.2 Uso sin conexión a Internet (Modo fuera de línea)
- Almacenamiento local del repertorio activo en la memoria del dispositivo (tablet o teléfono) para permitir la consulta completa aunque se interrumpa la conexión de red en el templo.

### 4.3 Desplazamiento automático de la pantalla
- Movimiento vertical continuo de la partitura o letra calculado de acuerdo con el tempo de la canción, permitiendo la lectura sin necesidad de pasar páginas manualmente.

### 4.4 Compatibilidad con pedales inalámbricos (Bluetooth)
- Soporte para pedales de pie inalámbricos que permitan cambiar de página o avanzar de canción sin soltar el instrumento musical.

### 4.5 Sincronización en tiempo real entre pantallas
- Comunicación entre dispositivos para que las indicaciones de cambio de tema o saltos de sección realizadas por el director se reflejen de manera coordinada en las pantallas de los músicos.
- Modalidad de control local para que cualquier músico pueda desvincularse temporalmente y revisar una sección sin afectar a los demás.

### 4.6 Importación desde archivos MIDI
- Lectura de archivos en formato `.mid`, identificación de pistas instrumentales y conversión a notación musical aprovechable en la plataforma.

### 4.7 Digitalización de partituras en PDF y fotografías
- Procesamiento de documentos PDF con partituras y reconocimiento de fotografías de hojas de acordes tomadas con la cámara, facilitando el ingreso de nuevo material.

### 4.8 Asistencia para análisis de grabaciones de audio
- Análisis de archivos de audio para sugerir el tempo, el compás y los acordes aproximados de una canción, actuando siempre como una sugerencia orientativa sujeta a revisión humana.

### 4.9 Edición interactiva avanzada de partituras
- Capacidad de modificar, agregar o reubicar notas y acordes directamente sobre el pentagrama interactivo desde la pantalla.

---

## 5. Posibles etapas futuras de desarrollo

Las funciones contempladas pueden organizarse en fases lógicas de avance según las prioridades que establezca el equipo:

### Etapa 1 — Atril de escenario enriquecido y autónomo
- **Propósito:** Brindar comodidad y autonomía al músico durante el servicio.
- **Capacidades contempladas:** Consulta del repertorio sin conexión a Internet en tablets y celulares; desplazamiento vertical automático de la partitura por tempo; compatibilidad con pedales Bluetooth; optimización visual para pantallas táctiles.

### Etapa 2 — Herramientas para el ensayo y la preparación
- **Propósito:** Apoyar el estudio individual durante la semana y hacer más dinámicos los ensayos generales.
- **Capacidades contempladas:** Metrónomo audible integrado; cuenta de entrada; repetición en bucle de fragmentos difíciles; ajuste gradual de velocidad de práctica; pistas de referencia asociadas a cada canción.

### Etapa 3 — Sincronización en vivo del equipo
- **Propósito:** Vincular los dispositivos de los integrantes bajo la guía del director.
- **Capacidades contempladas:** Modo de dirección compartida donde el líder avanza o señala secciones y las pantallas del equipo responden coordinadamente; opción de control individual para consultas puntuales; reconexión silenciosa ante variaciones de red.

### Etapa 4 — Creación e importación musical avanzada
- **Propósito:** Ampliar las vías de incorporación y edición de contenidos musicales.
- **Capacidades contempladas:** Importación desde archivos MIDI; conversión asistida de partituras en PDF; reconocimiento de fotos de hojas de acordes; edición interactiva de notas sobre el pentagrama.

### Etapa 5 — Asistencia e inteligencia musical
- **Propósito:** Brindar herramientas de apoyo para agilizar el análisis armónico.
- **Capacidades contempladas:** Detección tentativa de acordes y tempo a partir de muestras de audio.  
*(Criterio rector: Toda herramienta de análisis musical actúa como sugerencia técnica de apoyo, sujeta siempre a la validación y decisión del criterio musical humano).*

### Etapa 6 — Evolución comunitaria y organizativa
- **Propósito:** Acompañar el crecimiento de la congregación a mediano y largo plazo.
- **Capacidades contempladas:** Coordinación de múltiples grupos de alabanza dentro de la congregación; programación de ensayos y calendarios; posibles vinculaciones con servicios externos de catálogo de letras.


---

## 6. Propuesta de Alcance Actual para Evaluación de los Usuarios

A continuación se presenta la tabla resumen de las capacidades del sistema. Se invita a los usuarios a revisar cada punto y marcar con una equis (`X`) si la función debe formar parte del alcance actual, ajustarse o dejarse para más adelante:

| Nº | Funcionalidad / Capacidad | Estado en el proyecto | ¿Debe formar parte del alcance actual? | Observaciones y comentarios del equipo |
|:--:|:---|:---:|:---:|:---|
| **1** | Catálogo general de canciones con autor, compás y tempo | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **2** | Visualización en pentagrama con notas musicales (piano/vientos) | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **3** | Visualización en tablatura para guitarra | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **4** | Visualización de letra con acordes sobre cada palabra | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **5** | Visualización de letra sola en texto destacado para cantantes | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **6** | Cambio de tono en pantalla (transposición dinámica) | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **7** | Cálculo de posición de cejuela (capo) para guitarra | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **8** | Importación de canciones desde archivos MusicXML | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **9** | Importación de canciones desde archivos ChordPro | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **10** | Creación y programación de repertorios de culto (Setlists) | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **11** | Asignación de tono específico para cada tema en la reunión | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **12** | Integración de momentos del servicio (oración, ofrenda, etc.) | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **13** | Reordenamiento táctil de canciones y momentos (subir/bajar) | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **14** | Atril digital con botones de navegación (anterior/siguiente) | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **15** | Aviso del elemento siguiente durante la ejecución en vivo | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **16** | Consulta temporal de otro tema con opción de retorno al culto | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **17** | Control de accesos y perfiles de usuario | EN DESARROLLO | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **18** | Consulta del atril sin conexión a Internet (modo fuera de línea) | CONTEMPLADO PARA IMPLEMENTACIÓN | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **19** | Desplazamiento automático de la partitura/letra por tempo | CONTEMPLADO PARA IMPLEMENTACIÓN | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **20** | Avance de página y tema con pedal inalámbrico Bluetooth | CONTEMPLADO PARA IMPLEMENTACIÓN | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **21** | Metrónomo digital audible con cuenta de entrada | CONTEMPLADO PARA IMPLEMENTACIÓN | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **22** | Repetición en bucle de compases para ensayo individual | CONTEMPLADO PARA IMPLEMENTACIÓN | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **23** | Reproducción de pistas de audio de referencia y multitracks | CONTEMPLADO PARA IMPLEMENTACIÓN | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **24** | Sincronización en vivo entre pantallas del director y músicos | CONTEMPLADO PARA IMPLEMENTACIÓN | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **25** | Importación de canciones desde archivos MIDI | CONTEMPLADO PARA IMPLEMENTACIÓN | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **26** | Digitalización de partituras en PDF y fotografías de acordes | CONTEMPLADO PARA IMPLEMENTACIÓN | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **27** | Detección tentativa de acordes a partir de grabaciones de audio | CONTEMPLADO PARA IMPLEMENTACIÓN | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |
| **28** | Edición interactiva de notas directamente en el pentagrama | CONTEMPLADO PARA IMPLEMENTACIÓN | ☐ Sí &nbsp; ☐ Ajustar &nbsp; ☐ No | |

---

## 7. Decisiones que Necesitamos de los Usuarios

Para que el proyecto responda fielmente a su dinámica de trabajo, le solicitamos responder las siguientes preguntas:

1. **¿Qué instrumentos musicales participan habitualmente en su equipo de alabanza?**  
   *(Ejemplos: piano, teclado sintetizador, guitarra acústica, guitarra eléctrica, bajo, batería, saxofón, voces, etc.)*  
   *Respuesta:*  
   ____________________________________________________________________________________  
   ____________________________________________________________________________________  

2. **De esos instrumentos, ¿cuáles consideran indispensables que estén adaptados de forma prioritaria?**  
   *Respuesta:*  
   ____________________________________________________________________________________  
   ____________________________________________________________________________________  

3. **¿Qué información exacta necesita ver cada músico mientras está tocando en vivo?**  
   *(¿Requieren compases y figuras rítmicas completas, o resulta suficiente el cifrado sobre las palabras clave?)*  
   *Respuesta:*  
   ____________________________________________________________________________________  
   ____________________________________________________________________________________  

4. **¿Qué formato de lectura prefiere la mayoría de sus músicos: pentagrama con notas, cifrado con letra, letra sola, tablatura o una combinación?**  
   *Respuesta:*  
   ____________________________________________________________________________________  
   ____________________________________________________________________________________  

5. **Cuando se abre una canción en el atril de escenario, ¿qué elemento debe aparecer en primer plano?**  
   *(¿La tonalidad y el tempo, las notas del director, la primera estrofa, o la estructura general?)*  
   *Respuesta:*  
   ____________________________________________________________________________________  
   ____________________________________________________________________________________  

6. **¿Desde qué dispositivos necesitan utilizar Worship Studio principalmente?**  
   *(¿Teléfonos celulares, tablets en atriles, computadores portátiles o una combinación?)*  
   *Respuesta:*  
   ____________________________________________________________________________________  
   ____________________________________________________________________________________  

7. **¿Qué tan importante o prioritario consideran contar con un metrónomo integrado para los ensayos semanales?**  
   *(¿Ya emplean metrónomo o auriculares en los ensayos, o sería una herramienta nueva para el equipo?)*  
   *Respuesta:*  
   ____________________________________________________________________________________  
   ____________________________________________________________________________________  

8. **¿Utilizan o necesitan reproducir pistas de audio de referencia o multitracks (stems) durante la preparación o el ensayo?**  
   *Respuesta:*  
   ____________________________________________________________________________________  
   ____________________________________________________________________________________  

9. **¿Qué músicos de su equipo necesitarían utilizar pedales inalámbricos para cambiar de página sin soltar su instrumento?**  
   *(¿Guitarristas, pianistas, bajistas, bateristas?)*  
   *Respuesta:*  
   ____________________________________________________________________________________  
   ____________________________________________________________________________________  

10. **¿Qué tipo de sincronización entre pantallas consideran más útil?**  
    - Opción A: Que el director seleccione la canción y todos visualicen dicho tema.  
    - Opción B: Que el director marque secciones en vivo (coro, estrofa) y las pantallas del equipo salten coordinadamente.  
    - Opción C: Que cada músico mantenga control individual de sus páginas.  
    *Respuesta:*  
    ____________________________________________________________________________________  
    ____________________________________________________________________________________  

11. **¿Qué controles o información específica debería poder manejar el director de alabanza durante el servicio desde su pantalla?**  
    *Respuesta:*  
    ____________________________________________________________________________________  
    ____________________________________________________________________________________  

12. **De todas las funciones presentadas en este documento, ¿cuáles consideran estrictamente indispensables para la primera etapa de uso?**  
    *Respuesta:*  
    ____________________________________________________________________________________  
    ____________________________________________________________________________________  

13. **¿Hay alguna función de las mencionadas que consideren secundaria, innecesaria o que prefieran postergar para más adelante?**  
    *Respuesta:*  
    ____________________________________________________________________________________  
    ____________________________________________________________________________________  

14. **¿Qué funciones, dinámicas o necesidades específicas de su ministerio sienten que no están contempladas y desearían agregar?**  
    *Respuesta:*  
    ____________________________________________________________________________________  
    ____________________________________________________________________________________  

---

## 8. Cambios y Nuevas Ideas Propuestas por los Usuarios

Este espacio está reservado para que el equipo plantee sugerencias, ajustes o ideas que hayan surgido durante la lectura del documento o en sus reuniones de trabajo:

| Nº | Idea / Cambio Solicitado | Prioridad Sugerida | ¿Se incorpora a la próxima etapa? | Observaciones del equipo y del desarrollador |
|:--:|:---|:---:|:---:|:---|
| **1** | &nbsp; | ☐ Alta &nbsp; ☐ Media &nbsp; ☐ Baja | ☐ Sí &nbsp; ☐ Revisar &nbsp; ☐ No | &nbsp; |
| **2** | &nbsp; | ☐ Alta &nbsp; ☐ Media &nbsp; ☐ Baja | ☐ Sí &nbsp; ☐ Revisar &nbsp; ☐ No | &nbsp; |
| **3** | &nbsp; | ☐ Alta &nbsp; ☐ Media &nbsp; ☐ Baja | ☐ Sí &nbsp; ☐ Revisar &nbsp; ☐ No | &nbsp; |
| **4** | &nbsp; | ☐ Alta &nbsp; ☐ Media &nbsp; ☐ Baja | ☐ Sí &nbsp; ☐ Revisar &nbsp; ☐ No | &nbsp; |
| **5** | &nbsp; | ☐ Alta &nbsp; ☐ Media &nbsp; ☐ Baja | ☐ Sí &nbsp; ☐ Revisar &nbsp; ☐ No | &nbsp; |
| **6** | &nbsp; | ☐ Alta &nbsp; ☐ Media &nbsp; ☐ Baja | ☐ Sí &nbsp; ☐ Revisar &nbsp; ☐ No | &nbsp; |
| **7** | &nbsp; | ☐ Alta &nbsp; ☐ Media &nbsp; ☐ Baja | ☐ Sí &nbsp; ☐ Revisar &nbsp; ☐ No | &nbsp; |
| **8** | &nbsp; | ☐ Alta &nbsp; ☐ Media &nbsp; ☐ Baja | ☐ Sí &nbsp; ☐ Revisar &nbsp; ☐ No | &nbsp; |
| **9** | &nbsp; | ☐ Alta &nbsp; ☐ Media &nbsp; ☐ Baja | ☐ Sí &nbsp; ☐ Revisar &nbsp; ☐ No | &nbsp; |
| **10** | &nbsp; | ☐ Alta &nbsp; ☐ Media &nbsp; ☐ Baja | ☐ Sí &nbsp; ☐ Revisar &nbsp; ☐ No | &nbsp; |
| **11** | &nbsp; | ☐ Alta &nbsp; ☐ Media &nbsp; ☐ Baja | ☐ Sí &nbsp; ☐ Revisar &nbsp; ☐ No | &nbsp; |
| **12** | &nbsp; | ☐ Alta &nbsp; ☐ Media &nbsp; ☐ Baja | ☐ Sí &nbsp; ☐ Revisar &nbsp; ☐ No | &nbsp; |

---

## 9. Acuerdo de Alcance

El presente documento tiene como finalidad establecer un **entendimiento común y colaborativo** entre las personas que utilizarán Worship Studio y el equipo de desarrollo de software.

Al revisar y completar este documento, las partes coinciden en los siguientes principios de trabajo:

1. **Entendimiento compartido:** El presente documento establece una comprensión común entre los usuarios y el equipo de desarrollo acerca de las capacidades que se encuentran actualmente en desarrollo, las funciones contempladas para implementación futura y las prioridades identificadas por los usuarios.
2. **Priorización orientada al usuario:** La planificación y el orden de desarrollo de las próximas etapas se orientarán a partir de las necesidades, respuestas y observaciones manifestadas por los usuarios en este documento.

---

## 10. Resumen Final

**Worship Studio** se desarrolla con el propósito de ser una herramienta práctica, accesible y confiable para apoyar la preparación y el acompañamiento musical del equipo de alabanza.

El desarrollo actual abarca una biblioteca central de canciones, diferentes modos de visualización adaptados a cada instrumento, transposición dinámica de tonalidades, organización de repertorios para el culto, integración de momentos litúrgicos y una experiencia de atril digital para la ejecución musical.

Asimismo, se contemplan capacidades adicionales para etapas posteriores —como herramientas de ensayo, metrónomo, desplazamiento automático, compatibilidad con pedales, sincronización entre dispositivos y digitalización de partituras— cuyo orden y alcance se definirán a partir de las prioridades expresadas por los usuarios.

Este documento constituye un marco de referencia compartido para continuar el proyecto de manera ordenada y alineada con las verdaderas necesidades de quienes participan en el ministerio musical. Agradecemos sinceramente su tiempo, sus aportes y su colaboración activa.
