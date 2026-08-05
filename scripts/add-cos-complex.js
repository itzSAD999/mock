/**
 * Append COS Complex & Hall of Fame questions (skip duplicates + unverified HoD CS).
 */
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "data.js");
let src = fs.readFileSync(file, "utf8");

if (src.includes('id: "cos-complex"')) {
  console.log("cos-complex round already present — skip");
  process.exit(0);
}

const topics = {
  c: "History of COS",
  p: "Popular Locations & Offices on Campus",
  h: "History of KNUST",
};

function q(id, question, answer, topic) {
  return { id, q: question, a: answer, topic };
}

const items = [
  q("cos1", "What is the name of the College of Science building?", "The Aboagye Menyeh Complex", topics.c),
  q("cos2", "After whom is the College of Science building named, and what was his role?", "Prof. Aboagye Menyeh, foundation Provost of the College of Science (2004–2010)", topics.c),
  q("cos3", "What is the College of Science motto/tagline?", "The Bedrock of Development", topics.c),
  q("cos4", "State the Vision of the College of Science.", "To produce high calibre science graduates to support and sustain the industrial and economic development of Ghana and Africa", topics.c),
  q("cos5", "State the Mission of the College of Science.", "To provide high quality teaching, research, entrepreneurship training and service, and to develop programmes in the pure and applied sciences for the industrial and socio-economic development of Ghana and Africa", topics.c),
  q("cos6", "List the four core values of the College of Science.", "Excellence, Teamwork, Dedication to duty, Discipline", topics.c),
  q("cos7", "Who is the current Provost of the College of Science?", "Prof. Philip Antwi-Agyei", topics.c),
  q("cos8", "Who was Provost of the College of Science immediately before Prof. Philip Antwi-Agyei?", "Prof. Leonard Kofitse Amekudzi (2019–2025)", topics.c),
  q("cos9", "Who is the Dean of the Faculty of Physical and Computational Sciences?", "Prof. Osei Akoto", topics.c),
  q("cos10", "Who is the College of Science Counsellor?", "Mr. Rabbi Darko", topics.c),
  q("cos11", "Who is the Examination Officer for the Department of Computer Science?", "Dr. Owusu Agyeman", topics.c),
  q("cos12", "Which departments are located in the basement of the Aboagye Menyeh Complex?", "Optometry and Visual Science (B22) and Food Science and Technology (B15)", topics.p),
  q("cos13", "Which room is the Department of Optometry and Visual Science in the Aboagye Menyeh Complex?", "B22", topics.p),
  q("cos14", "Which room is the Department of Food Science and Technology in the Aboagye Menyeh Complex?", "B15", topics.p),
  q("cos15", "Which room is the Auditorium in the Aboagye Menyeh Complex, and what is it called?", "GF1 — the Allotey Auditorium", topics.p),
  q("cos16", "Which department is on the first floor of the Aboagye Menyeh Complex?", "Computer Science (FF4)", topics.p),
  q("cos17", "Which two departments share the second floor of the Aboagye Menyeh Complex?", "Mathematics (SF6) and Statistics and Actuarial Science (SF24)", topics.p),
  q("cos18", "Which room is the Department of Statistics and Actuarial Science?", "SF24", topics.p),
  q("cos19", "Name the four facilities listed on the third floor of the Aboagye Menyeh Complex.", "Office of the Provost (TF31), College Library, Conference Room, Accounts Office", topics.p),
  q("cos20", "In the Aboagye Menyeh Complex, GF3 is whose office?", "Head of Department, Biochemistry and Biotechnology", topics.p),
  q("cos21", "GF4 is the general office of which department?", "Biochemistry and Biotechnology", topics.p),
  q("cos22", "Which laboratory is signposted at GF8–GF13?", "Oldham Laboratory", topics.p),
  q("cos23", "GF14 is which laboratory?", "Food Science and Technology Laboratories (Food Analysis Laboratory)", topics.p),
  q("cos24", "What is GF15 in the Aboagye Menyeh Complex?", "The Staff Common Room / Tea Room", topics.p),
  q("cos25", "Who is permitted to use GF15 (Staff Common Room / Tea Room)?", "Senior members only — out of bounds for students and teaching assistants", topics.p),
  q("cos26", "FF4 is the general office of which department?", "Computer Science", topics.p),
  q("cos27", "What instruction is posted on the FF4 (Computer Science) door?", "Please knock once and enter", topics.p),
  q("cos28", "Where is the Simulation Lab located in the Aboagye Menyeh Complex?", "FF8", topics.p),
  q("cos29", "SF6 is the general office / reception of which department?", "Mathematics", topics.p),
  q("cos30", "Which room is the Senior Common Room in the Aboagye Menyeh Complex?", "SF25", topics.p),
  q("cos31", "Which room houses the Office of the Provost and the Provost Registrar (general office / reception)?", "TF31", topics.p),
  q("cos32", "Where is the College IT Office in the Aboagye Menyeh Complex?", "TF19", topics.p),
  q("cos33", "What instruction is posted on the College IT Office door?", "Please knock and enter", topics.p),
  q("cos34", "Which room is the Examinations Office in the Aboagye Menyeh Complex?", "TF24", topics.p),
  q("cos35", "Which room is the Accounts General Office?", "TF27", topics.p),
  q("cos36", "Which room is the College Accountant's office?", "TF28", topics.p),
  q("cos37", "Which room is the College Counsellor's office?", "TF35", topics.p),
  q("cos38", "What contact numbers are posted for the College Counsellor?", "0559540176 / 0242887536", topics.p),
  q("cos39", "What is the name of the third-floor boardroom in the Aboagye Menyeh Complex?", "IbisTek Boardroom", topics.p),
  q("cos40", "What are the College Library's opening hours?", "Monday to Friday, 9:00 AM – 5:00 PM", topics.p),
  q("cos41", "Which office handles research funding and grant applications at the College of Science?", "Office of Grants and Research (OGR)", topics.c),
  q("cos42", "Which Hall of Fame member from the Department of Chemistry served as Vice-Chancellor from 1992 to 1997?", "Prof. Eugene Hammond Amonoo-Neizer", topics.h),
  q("cos43", "Which Vice-Chancellor (2010–2016) came from the Department of Food Science and Technology?", "Prof. William Otoo Ellis", topics.h),
  q("cos44", "Which Vice-Chancellor (2016–2020) came from the Department of Theoretical and Applied Biology?", "Prof. Kwasi Obiri-Danso", topics.h),
  q("cos45", "Who served as Pro Vice-Chancellor of KNUST in 1978–1979, having been Head of Mathematics and Dean of the Faculty of Science?", "Prof. Francis Kofi Ampenyin Allottey (Allotey)", topics.h),
  q("cos46", "Who was the foundation Provost of the College of Science, and for what years?", "Prof. Aboagye Menyeh, 2004–2010", topics.c),
  q("cos47", "Which Provost of the College of Science (2010–2013) came from the Department of Physics?", "Prof. Robert Kwame Nkum", topics.c),
  q("cos48", "Who was the first female Provost of the College of Science?", "Prof. (Mrs) Ibok Nsa Oduro (2016–2019)", topics.c),
  q("cos49", "Which Provost of the College of Science is an Atmospheric and Climate Scientist?", "Prof. Leonard Kofitse Amekudzi (2019–2025)", topics.c),
  q("cos50", "Put these Provosts in chronological order: Amekudzi, Menyeh, Nkum, Oduro.", "Menyeh (2004–2010), Nkum (2010–2013), Oduro (2016–2019), Amekudzi (2019–2025)", topics.c),
  q("cos51", "Who was the first Head of the Department of Physics (1963–1966)?", "Prof. Kenneth Charles Whittaker", topics.c),
  q("cos52", "Who was a founding member of the Department of Chemistry?", "Prof. Kwesi Aggrey", topics.c),
  q("cos53", "Who was the first female Professor in the College of Science?", "Prof. (Mrs) Victoria Pearl Dzogbefia", topics.c),
  q("cos54", "For what was Prof. Victoria Pearl Dzogbefia awarded Distinguished University Professor?", "Being the first female Professor in the College and her contributions to Biotechnology and Biochemistry", topics.c),
  q("cos55", "Who is Ghana's first Professor of Optometry?", "Prof. (Mrs) Angela Ofeibea Amedo", topics.c),
  q("cos56", "Who was the longest-serving Head of the Department of Optometry and Visual Science (2008–2014)?", "Prof. (Mrs) Angela Ofeibea Amedo", topics.c),
  q("cos57", "Who pioneered optometry in Ghana and established the training programme at KNUST?", "The late Dr. Francis Kojovi Morny", topics.c),
  q("cos58", "Which body recognised Dr. Francis Kojovi Morny as vital to the development of optometry in Africa?", "The World Council of Optometry", topics.c),
  q("cos59", "Which Emeritus Professor served as Head of Physics and Dean of the Faculty of Science (1993–1998)?", "Emeritus Prof. Keshaw Singh", topics.c),
  q("cos60", "Who served as Head of the Department of Physics from 2005–2007 and again 2009–2017?", "Prof. Sylvester Kojo Danuor", topics.c),
  q("cos61", "Which programme did Prof. Sylvester Kojo Danuor spearhead, and with which partners?", "The undergraduate degree in Meteorology and Climate Science, with the Ghana Meteorological Agency and the University of Leeds, UK", topics.c),
  q("cos62", "Which Hall of Fame member is recognised for distinguished research in microbiology and mentorship?", "Prof. Robert Clement Abaidoo (Theoretical and Applied Biology)", topics.c),
  q("cos63", "Which Hall of Fame member is recognised especially for administrative support in examinations?", "Prof. William Gariba Akanwariwiak (Theoretical and Applied Biology)", topics.c),
  q("cos64", "Who was a former Director of the Institute of Distance Learning (2016–2018)?", "Prof. Isaac Kwame Dontwi", topics.c),
  q("cos65", "Which Hall of Fame member is recognised for enzyme applications in food processing, seafood quality and food biotechnology?", "Prof. Benjamin Kofi Simpson", topics.c),
  q("cos66", "What does HuGENE stand for?", "Human Genetics and Genomics Laboratory (Dept. of Biochemistry and Biotechnology)", topics.p),
  q("cos67", "When was the HuGENE Lab commissioned, and by whom?", "2 February 2023, by Prof. (Mrs) Rita Akosua Dickson, assisted by Prof. Leonard Amekudzi", topics.p),
  q("cos68", "Who is the Principal Investigator of the HuGENE Lab?", "Dr. Lord Jephthah Joojo Gowans", topics.p),
  q("cos69", "Name the two Multiple Principal Investigators on the HuGENE plaque.", "Dr. Solomon Obiri-Yeboah and Prof. Michael Lawrence Cunningham", topics.p),
  q("cos70", "Which agency funded the HuGENE Lab?", "Fogarty International Center (FIC), National Institutes of Health", topics.p),
  q("cos71", "What does COSCOMP Lab (CCL) stand for?", "College of Science Computer Laboratory", topics.p),
  q("cos72", "Who funded the Simulation Laboratory?", "The World Bank and the Department of Computer Science (AFUF)", topics.p),
  q("cos73", "When was the Simulation Laboratory commissioned, and by whom?", "Thursday, 5 October 2017, by Prof. Kwasi Obiri-Danso", topics.p),
  q("cos74", "Who was Head of Computer Science when the Simulation Lab was built?", "Dr. Michael Asante", topics.p),
  q("cos75", "What does the letter prefix in a College of Science room code tell you?", "The floor: B = Basement, GF = Ground Floor, FF = First Floor, SF = Second Floor, TF = Third Floor", topics.p),
  q("cos76", "On which floor would you find room TF24?", "Third floor", topics.p),
  q("cos77", "On which floor would you find room B15?", "Basement", topics.p),
  q("cos78", "A student is told to report to SF24. Which floor and which department?", "Second floor, Department of Statistics and Actuarial Science", topics.p),
  q("cos79", "Which office is located at B3 in the Aboagye Menyeh Complex?", "Internal Audit", topics.p),
  q("cos80", "Which two offices handle College money matters, and where are they?", "Accounts General Office (TF27) and College Accountant (TF28), with Internal Audit at B3", topics.p),
  q("cos81", "Who is the College Registrar of the College of Science?", "Mrs. Mercy V. D. Appiah-Castel (Mercy Vanessa Appiah-Castel)", topics.c),
  q("cos82", "Who is the College Finance Officer of the College of Science?", "Dr. James Gambrah", topics.c),
  q("cos83", "Who is the College Librarian of the College of Science?", "Dr. Richard Bruce Lamptey", topics.c),
  q("cos84", "Who is the College Internal Auditor of the College of Science, and which room is Internal Audit?", "Mr. John Norago Nyerrinya; Internal Audit is at B3", topics.c),
  q("cos85", "Who is the College Examinations Officer (college-level) of the College of Science?", "Prof. Isaac Nkrumah", topics.c),
  q("cos86", "How many faculties and how many research centres does the College of Science comprise?", "Two main faculties and three research centres", topics.c),
  q("cos87", "Approximately how many academic staff and students does the College of Science have (as published on the College site)?", "About 200 academic staff and about 10,366 students", topics.c),
  q("cos88", "How many undergraduate and postgraduate programmes does the College of Science run, across how many departments?", "12 undergraduate and 45 postgraduate programmes in 11 departments", topics.c),
  q("cos89", "What is the College of Science Provost email address?", "provost.sci@knust.edu.gh", topics.c),
  q("cos90", "Name a published College of Science Provost Office telephone number.", "+233-3220-60313 (also listed: +233-3220-60333 / 60312)", topics.c),
  q("cos91", "What is the postal / campus address line used for the College of Science Provost Office?", "Provost Office, College of Science, KNUST-Kumasi (University Post Office, Kumasi)", topics.p),
  q("cos92", "According to the College of Science website, CoS is described as what among science colleges in Ghana?", "The premier and preferred College of Science in Ghana", topics.c),
];

function serialize(obj) {
  return [
    "        {",
    `          id: ${JSON.stringify(obj.id)},`,
    `          q: ${JSON.stringify(obj.q)},`,
    `          a: ${JSON.stringify(obj.a)},`,
    `          topic: ${JSON.stringify(obj.topic)},`,
    "        }",
  ].join("\n");
}

const round = `    {
      id: "cos-complex",
      name: "COS Complex & Hall of Fame",
      round: 6,
      count: ${items.length},
      type: "open",
      description: "Aboagye Menyeh Complex offices, leadership, directory rooms, and College Hall of Fame (from on-site signage).",
      questions: [
${items.map(serialize).join(",\n")}
      ],
    }`;

const marker = "    },\n  ],\n};\n\n// Live total";
const idx = src.indexOf(marker);
if (idx < 0) {
  const alt = src.indexOf("  ],\r\n};\r\n\r\n// Live total");
  if (alt < 0) throw new Error("insert marker not found");
}
const nl = src.includes("\r\n") ? "\r\n" : "\n";
const markers = [
  `    },${nl}  ],${nl}};${nl}${nl}// Live total`,
];
let found = -1;
let used = null;
for (const m of markers) {
  const i = src.lastIndexOf(m);
  if (i >= 0) {
    found = i;
    used = m;
    break;
  }
}
if (found < 0) throw new Error("insert marker not found");

// Insert before the closing of rounds array: replace last `    },` + `  ],` of expand round end
// The marker starts at expand's closing `    },` — we need `,` after expand then new round
src =
  src.slice(0, found) +
  `    },${nl}` +
  round.replace(/\n/g, nl) +
  `,${nl}  ],${nl}};${nl}${nl}// Live total` +
  src.slice(found + used.length);

fs.writeFileSync(file, src);
console.log("added cos-complex round with", items.length, "questions");
