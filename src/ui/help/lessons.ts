import { nb, nbBlock, type Block } from './content';

/**
 * "APRENDE DE NEGOCIOS" (v2.1): lecciones cortas para quien está empezando, con ejemplos de un negocio
 * de celulares y accesorios, una calculadora para probar con tus números y preguntas para repasar.
 */

export type CalcKind = 'cost' | 'margin' | 'profit' | 'cash' | 'capital' | 'rotation' | 'salary' | 'pricing' | 'negotiate' | 'lots';

export interface QuizQuestion {
  q: string;
  options: string[];
  answer: number;
  explain: string;
}

export interface Lesson {
  id: string;
  emoji: string;
  title: string;
  summary: string;
  minutes: number;
  blocks: Block[];
  calc: CalcKind;
  quiz: QuizQuestion[];
  tryIt?: { to: string; label: string };
}

export const LESSONS: Lesson[] = [
  {
    id: 'costo',
    emoji: '🧾',
    title: 'Costo y precio no son lo mismo',
    summary: 'Qué entra en el costo de un producto y por qué de eso depende tu ganancia.',
    minutes: 3,
    blocks: [
      { p: 'El costo es todo lo que te cuesta tener un producto listo para vender. El precio es lo que le cobras al cliente. Tu ganancia sale de la diferencia.' },
      { h: '¿Qué entra en el costo?' },
      { list: ['Lo que le pagaste al proveedor.', 'El transporte o el envío para traerlo (pasajes, domicilio).', 'Las reparaciones o piezas que le cambiaste (batería, pantalla…).', 'Las comisiones de la compra, si las hay.'] },
      { p: 'Ejemplo: compras un iPhone en 1 200 000, pagas 20 000 de transporte y le cambias la batería por 80 000. Tu costo real es 1 300 000, no 1 200 000. Si lo vendes en 1 350 000, ganas 50 000, no 150 000.' },
      { tip: 'En la app, el transporte va en "Gastos adicionales" de la compra (o después con "Agregar gasto a esta compra") y las reparaciones en la ficha del equipo. Así el costo queda completo solo.' },
    ],
    calc: 'cost',
    quiz: [
      { q: 'Compraste unos audífonos en 30 000 y pagaste 4 000 de domicilio. ¿Cuál es su costo?', options: ['30 000', '34 000', '26 000'], answer: 1, explain: 'El domicilio para traerlos es parte del costo: 30 000 + 4 000 = 34 000.' },
      { q: '¿Por qué importa registrar las reparaciones de un equipo?', options: ['Porque suben su costo y así sabes tu ganancia real', 'No importa: solo cuenta lo que le pagaste al proveedor', 'Para que el precio de venta baje'], answer: 0, explain: 'Una batería nueva de 80 000 es plata que pusiste en ese equipo: si no la sumas, creerás que ganaste más de lo que ganaste.' },
      { q: 'Vendes en 100 000 algo que te costó 80 000 en total. ¿Cuánto ganas?', options: ['100 000', '20 000', '180 000'], answer: 1, explain: 'Ganancia = precio − costo = 100 000 − 80 000 = 20 000.' },
    ],
    tryIt: { to: '/compras/nueva', label: 'Registrar una compra' },
  },
  {
    id: 'margen',
    emoji: '📈',
    title: 'Margen: cuánto te queda por venta',
    summary: 'Ganancia por unidad, margen sobre el precio, ganancia sobre el costo y precio mínimo.',
    minutes: 3,
    blocks: [
      { p: 'La ganancia por unidad es precio − costo. El margen dice qué parte del precio es ganancia: (precio − costo) ÷ precio × 100.' },
      { p: 'Ejemplo: costo 80 000 y precio 100 000 → ganas 20 000, un margen del 20 %. Sobre el costo ganaste un 25 %.' },
      { warn: 'Ganar 20 % sobre el costo NO es lo mismo que un margen del 20 % sobre el precio. Si quieres un margen del 20 %, el precio es costo ÷ 0,8.' },
      { p: 'Un margen mínimo te protege: la app te avisa si vas a vender por debajo. Lo configuras en Configuración → Precios, en pesos o en %.' },
    ],
    calc: 'margin',
    quiz: [
      { q: 'Costo 50 000 y precio 60 000. ¿Cuál es el margen sobre el precio?', options: ['10 %', '16,7 %', '20 %'], answer: 1, explain: '10 000 ÷ 60 000 = 16,7 %. Sobre el costo serían 20 %.' },
      { q: 'Vender más unidades con un precio por debajo del costo…', options: ['Te hace perder más plata', 'Siempre te hace ganar', 'No cambia nada'], answer: 0, explain: 'Cada unidad vendida bajo el costo es una pérdida: más ventas, más pérdida.' },
      { q: '¿Para qué sirve el precio mínimo de la app?', options: ['Para avisarte si una venta no te deja la ganancia mínima que quieres', 'Para subir los precios solos', 'Para calcular impuestos'], answer: 0, explain: 'Es tu "piso": costo + el margen mínimo que configuraste.' },
    ],
  },
  {
    id: 'ganancia',
    emoji: '💰',
    title: 'Ganancia bruta y ganancia neta',
    summary: 'Lo que te dejan los productos y lo que de verdad te queda después de gastos.',
    minutes: 3,
    blocks: [
      { p: 'Ganancia bruta = lo que vendiste − lo que te costó lo vendido. Es lo que te dejan los productos.' },
      { p: 'Ganancia neta = ganancia bruta − gastos del negocio (publicidad, empaques, comisiones del datáfono, intereses, arriendo…). Es lo que de verdad te queda.' },
      { p: 'Ejemplo del mes: vendiste 3 000 000 y lo vendido te costó 2 400 000 → bruta 600 000. Gastaste 150 000 en publicidad y empaques → neta 450 000.' },
      { tip: 'En Informes → Finanzas ves las dos. Si la bruta es buena pero la neta es baja, revisa tus gastos.' },
    ],
    calc: 'profit',
    quiz: [
      { q: 'Vendiste 1 000 000, lo vendido costó 700 000 y gastaste 100 000 en publicidad. ¿Cuál es la ganancia neta?', options: ['300 000', '200 000', '1 000 000'], answer: 1, explain: 'Bruta = 300 000; neta = 300 000 − 100 000 = 200 000.' },
      { q: '¿Comprar mercancía es un gasto que baja la ganancia?', options: ['No: es inversión; se vuelve costo cuando la vendes', 'Sí, siempre', 'Solo si es mucha plata'], answer: 0, explain: 'Comprar cambia plata por productos. El costo aparece cuando vendes esos productos.' },
      { q: '¿Qué es un gasto operativo?', options: ['Un gasto del negocio que no es mercancía, como publicidad o empaques', 'Lo que pagas por los productos', 'Un gusto personal'], answer: 0, explain: 'Son los gastos de funcionar. Los gustos personales no son del negocio: son plata que sacas.' },
    ],
  },
  {
    id: 'caja',
    emoji: '🏦',
    title: 'Caja no es ganancia',
    summary: 'Por qué puedes tener plata en la caja y no estar ganando (o al revés).',
    minutes: 3,
    blocks: [
      { p: 'La caja es la plata que hay. La ganancia es lo que el negocio produjo. Pueden ser muy distintas:' },
      {
        list: [
          'Si metes 1 000 000 de tu bolsillo (aporte), la caja sube, pero no ganaste nada.',
          'Si compras mercancía, la caja baja, pero no perdiste: ahora tienes productos.',
          'Si vendes fiado, ganaste, pero la plata todavía no está en la caja.',
          'Si pagas con la tarjeta de crédito, la caja no baja hoy, pero tienes una deuda.',
        ],
      },
      { p: 'Por eso la app separa: Informes (ganancia), Capital (caja, valor del negocio y crecimiento) y Deudas.' },
      { tip: 'Cuenta tu plata de vez en cuando y compárala con la caja calculada. Si no coincide, usa "Cuadrar caja" en Capital.' },
    ],
    calc: 'cash',
    quiz: [
      { q: 'Metiste 500 000 de tu plata al negocio. ¿Subió tu ganancia?', options: ['No: es un aporte; sube la caja, no la ganancia', 'Sí, 500 000', 'Depende del mes'], answer: 0, explain: 'Un aporte es plata tuya que entra: no la produjo el negocio.' },
      { q: 'Compraste mercancía por 800 000 con la caja. ¿Perdiste 800 000?', options: ['No: cambiaste plata por productos', 'Sí', 'Solo si no la vendes hoy'], answer: 0, explain: 'El valor sigue en tu negocio, ahora como mercancía.' },
      { q: 'Vendiste fiado por 200 000. ¿Dónde aparece?', options: ['En la ganancia y en "por cobrar", no en la caja', 'Solo en la caja', 'En ninguna parte'], answer: 0, explain: 'Cuando te paguen, pasa de "por cobrar" a la caja.' },
    ],
  },
  {
    id: 'capital',
    emoji: '🌱',
    title: 'Capital: lo que pusiste y lo que creció',
    summary: 'Capital aportado, valor del negocio y crecimiento, con un ejemplo.',
    minutes: 3,
    blocks: [
      { p: 'Capital aportado = la plata (y la mercancía) que tú has puesto en el negocio, menos lo que has sacado.' },
      { p: 'Valor del negocio = caja + mercancía a costo + lo que te deben − lo que debes.' },
      { p: 'Crecimiento = valor del negocio − capital aportado. Es lo que el negocio ganó por sí mismo.' },
      { p: 'Ejemplo: pusiste 2 000 000. Hoy tienes 900 000 en caja, 1 500 000 en mercancía y te deben 100 000; debes 200 000 de la tarjeta. Valor = 2 300 000. Creciste 300 000 (15 %).' },
      { tip: 'Registra tu aporte inicial en Capital → Aporte. Sin eso, la app no puede calcular cuánto creces.' },
    ],
    calc: 'capital',
    quiz: [
      { q: 'Si retiras 100 000 para ti, ¿cambia el crecimiento del negocio?', options: ['No: baja el valor, pero también lo aportado', 'Sí, baja 100 000', 'Sube'], answer: 0, explain: 'El crecimiento mide lo que ganó el negocio; sacar plata no cambia lo que ganó, pero sí lo que queda para trabajar.' },
      { q: 'Pusiste 1 000 000 y el negocio vale 1 200 000. ¿Cuánto creció?', options: ['200 000 (20 %)', '1 200 000', '2 200 000'], answer: 0, explain: '1 200 000 − 1 000 000 = 200 000, que es el 20 % de lo que pusiste.' },
      { q: '¿Las deudas restan del valor del negocio?', options: ['Sí', 'No', 'Solo las de proveedores'], answer: 0, explain: 'Lo que debes no es tuyo todavía: se resta.' },
    ],
    tryIt: { to: '/capital', label: 'Ver mi capital' },
  },
  {
    id: 'rotacion',
    emoji: '⚡',
    title: 'Vender rápido también es ganar',
    summary: 'Ganancia por día, rotación y dinero dormido.',
    minutes: 3,
    blocks: [
      { p: 'No solo importa cuánto ganas por producto, sino cuánto tarda en venderse. Mientras no se vende, tu plata está quieta.' },
      { p: 'Ejemplo: el producto A te deja 80 000 pero tarda 60 días. El B te deja 40 000 y se vende en 10 días. Con la plata de B puedes comprar y vender 6 veces en esos 60 días: 240 000.' },
      { p: 'La app te muestra la ganancia por día de cada modelo en Informes → Rentabilidad y el "dinero dormido" en Capital.' },
      { tip: 'Si algo lleva mucho tiempo sin venderse, a veces conviene bajarle un poco y volver a invertir esa plata en algo que se venda más rápido.' },
    ],
    calc: 'rotation',
    quiz: [
      { q: 'A deja 60 000 en 30 días; B deja 30 000 en 5 días. ¿Cuál deja más por día?', options: ['B (6 000 por día contra 2 000)', 'A', 'Igual'], answer: 0, explain: '60 000 ÷ 30 = 2 000 por día; 30 000 ÷ 5 = 6 000 por día.' },
      { q: '¿Qué es el dinero dormido?', options: ['Lo que te costó la mercancía que lleva mucho tiempo sin venderse', 'La plata del banco', 'Las deudas'], answer: 0, explain: 'Es plata que podría estar trabajando en otra compra.' },
      { q: 'Si tu inventario se vende más rápido…', options: ['Recuperas la plata antes y puedes volver a comprar', 'Siempre ganas menos', 'No importa'], answer: 0, explain: 'Más vueltas al año con la misma plata = más ganancia.' },
    ],
    tryIt: { to: '/informes?tab=rentabilidad', label: 'Ver ganancia por día' },
  },
  {
    id: 'sueldo',
    emoji: '🐜',
    title: 'Gastos hormiga y tu sueldo de dueño',
    summary: 'La plata del negocio es del negocio: cómo darte gustos sin comerte el capital.',
    minutes: 4,
    blocks: [
      { p: 'Un gasto hormiga es pequeño y repetido: un tinto, un snack, un domicilio. Uno solo no se siente, pero juntos pesan.' },
      { p: 'La plata del negocio es del negocio. Si sacas para ti "de a poquito" sin anotarlo, nunca sabrás cuánto te deja el negocio y te puedes comer el capital sin darte cuenta.' },
      { h: 'Págate un sueldo' },
      {
        steps: [
          'Mira cuánto ganó el negocio el mes pasado (ganancia neta).',
          'Decide un porcentaje para ti (por ejemplo 40 %) y deja el resto para que el negocio crezca.',
          'Sácalo una vez al mes como Retiro y date tus gustos de ahí.',
          'Si necesitas plata extra, regístrala como Préstamo a ti y devuélvela.',
        ],
      },
      { tip: 'En "Gastos personales" la app te dice si un gusto sale de tus ganancias o del capital del negocio.' },
    ],
    calc: 'salary',
    quiz: [
      { q: 'Un tinto de 3 000 todos los días es, al mes, más o menos…', options: ['90 000', '3 000', '30 000'], answer: 0, explain: '3 000 × 30 días = 90 000. Al año, más de un millón.' },
      { q: 'Si en un mes sacas más de lo que ganó el negocio…', options: ['Te comes el capital para comprar mercancía', 'No pasa nada', 'El negocio crece'], answer: 0, explain: 'Lo que sacas de más sale de la plata con la que trabajas.' },
      { q: 'Necesitas plata del negocio para una emergencia y la vas a devolver. ¿Cómo la registras?', options: ['Como préstamo a ti', 'Como gasto del negocio', 'No la registro'], answer: 0, explain: 'Así la app recuerda que el negocio te prestó y que la debes devolver.' },
    ],
    tryIt: { to: '/personal', label: 'Ver mis gastos personales' },
  },
  {
    id: 'precios',
    emoji: '🏷️',
    title: 'Cómo poner tus precios',
    summary: 'Costo, margen mínimo y precio de mercado; y cuánto pagar al comprar.',
    minutes: 3,
    blocks: [
      { p: 'Para poner un buen precio mira tres cosas: tu costo, tu margen mínimo y lo que se paga en el mercado.' },
      {
        steps: [
          'Costo real (con transporte y reparaciones).',
          'Precio mínimo = costo + el margen mínimo que quieres ganar.',
          'Precio de mercado: mira en Marketplace a cuánto se vende ese modelo en ese estado.',
          'Si el mercado está por encima de tu mínimo, vende cerca del mercado. Si está por debajo, piénsalo bien antes de comprar más de ese modelo.',
        ],
      },
      { p: 'Para comprar, la calculadora "¿Cuánto pagar?" hace la cuenta al revés: con el precio de mercado y tu margen te dice lo máximo que deberías pagar.' },
      { tip: 'Anota los precios de mercado en "Precios de mercado": la app los usa para sugerirte el precio al vender.' },
    ],
    calc: 'pricing',
    quiz: [
      { q: 'Costo 1 000 000 y quieres ganar mínimo 10 %. ¿Precio mínimo?', options: ['1 100 000', '1 010 000', '1 000 000'], answer: 0, explain: '1 000 000 + 10 % = 1 100 000.' },
      { q: 'En el mercado pagan 900 000 por un equipo que te costaría 950 000. ¿Qué haces?', options: ['No lo compro a ese precio, o negocio más barato', 'Lo compro igual', 'Lo compro y lo vendo en 900 000'], answer: 0, explain: 'Si el mercado paga menos que tu costo, perderías al venderlo.' },
      { q: '¿De dónde saca la app el precio de mercado?', options: ['De lo que tú anotas', 'De internet, automáticamente', 'Del proveedor'], answer: 0, explain: 'La app no se conecta a internet: tú anotas lo que ves y queda el historial con fechas.' },
    ],
    tryIt: { to: '/calculadora', label: 'Abrir "¿Cuánto pagar?"' },
  },
  {
    id: 'proveedores',
    emoji: '🤝',
    title: 'Negociar con tus proveedores',
    summary: 'Comprar mejor es la forma más directa de ganar más.',
    minutes: 3,
    blocks: [
      { p: 'Comprar más barato te deja más ganancia sin subir precios.' },
      {
        list: [
          'Conoce tus números: en la ficha del producto ves lo que pagaste cada vez y a cada proveedor.',
          'Compara proveedores: el más barato no siempre es el mejor si te da equipos con piezas genéricas o devoluciones. Mira su calificación en Informes.',
          'Pide descuento por volumen o por pagar de contado.',
          'Si un proveedor te baja el precio, aprovéchalo, pero no rebajes de inmediato lo que ya tenías.',
        ],
      },
      { p: 'Ejemplo: si compras 20 audífonos al mes y logras 2 000 menos por unidad, ganas 40 000 más al mes (480 000 al año) sin vender ni uno más.' },
    ],
    calc: 'negotiate',
    quiz: [
      { q: 'Bajar 1 000 en el precio de compra de 30 unidades al mes son…', options: ['30 000 más de ganancia al mes', '1 000 al mes', '300 000 al mes'], answer: 0, explain: '1 000 × 30 = 30 000 al mes.' },
      { q: '¿El proveedor más barato es siempre el mejor?', options: ['No necesariamente: mira también calidad, devoluciones y qué tan rápido se vende', 'Sí, siempre', 'Nunca'], answer: 0, explain: 'Un equipo barato que vuelve por garantía puede salirte caro.' },
      { q: '¿Dónde ves cuánto le pagaste antes a cada proveedor?', options: ['En la ficha del producto, en "Lo que has pagado"', 'En Configuración', 'No se puede ver'], answer: 0, explain: 'También aparece al registrar una compra: "La última vez pagaste…".' },
    ],
  },
  {
    id: 'lotes',
    emoji: '📦',
    title: 'Compraste más barato: ¿y ahora?',
    summary: 'Qué hacer cuando el proveedor te baja el precio y ya tenías mercancía más cara.',
    minutes: 3,
    blocks: [
      { p: 'Pasa mucho: tienes audífonos que te costaron 30 000 y ahora el proveedor te los deja en 22 000. ¿Cuánto te costó "cada audífono"?' },
      { p: 'Con costo promedio, todo se mezcla en un solo costo (por ejemplo 26 444). Con lotes, cada compra guarda su precio: 5 a 30 000 y 4 a 22 000.' },
      { p: 'Al vender, sale primero el lote más antiguo (el de 30 000). Así sabes la ganancia real de cada venta y el precio mínimo de cada lote.' },
      { warn: 'No bajes el precio de los anteriores por debajo de su mínimo solo porque ahora te salieron más baratos: perderías plata en esas unidades.' },
      { tip: 'Los lotes vienen prendidos. Si prefieres el costo promedio en un producto, apágalos en su ficha ("Por precio de compra").' },
    ],
    calc: 'lots',
    quiz: [
      { q: 'Tienes 5 a 30 000 y 4 a 22 000. Vendes 1 sin elegir lote. ¿De cuál sale?', options: ['Del más antiguo (30 000)', 'Del más barato', 'Del más nuevo'], answer: 0, explain: 'Primero sale lo más antiguo. Si quieres, puedes elegir otro lote al vender.' },
      { q: 'Si vendes en 28 000 uno del lote de 30 000…', options: ['Pierdes 2 000', 'Ganas 6 000', 'Ganas 28 000'], answer: 0, explain: '28 000 − 30 000 = −2 000. Con el lote nuevo sí ganarías 6 000.' },
      { q: '¿Se pueden apagar los lotes?', options: ['Sí, en la ficha de cada producto', 'No', 'Solo borrando el producto'], answer: 0, explain: 'Y se pueden volver a prender: la app reconstruye los lotes con tu historial.' },
    ],
    tryIt: { to: '/ayuda/lotes', label: 'Cómo funcionan los lotes en la app' },
  },
];

for (const l of LESSONS) {
  l.blocks = l.blocks.map(nbBlock);
  l.quiz = l.quiz.map((q) => ({ q: nb(q.q), options: q.options.map(nb), answer: q.answer, explain: nb(q.explain) }));
}

export function findLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}
