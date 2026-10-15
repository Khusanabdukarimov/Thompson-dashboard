/**
 * Viloyat filter on Lidlar: the Bitrix Филиал values (UF_CRM_1618299635672)
 * grouped by region. Matched by the option's name, so a re-created option with a
 * new id still lands in the right region. Branches not listed here (e.g.
 * Корпоративный, or a branch added in Bitrix later) fall into "Boshqa".
 *
 * Grouping evidence: deals of these branches sit in the matching
 * "Визит в офис Тошкент / Навои / Фаргона / Наманган" stage; branches without
 * deals are placed by their name (Navoi region districts and cities, Tashkent
 * districts and neighbourhoods).
 */
const REGIONS = [
  {
    id: 'toshkent', name: 'Toshkent',
    filials: [
      'Drujba', 'Drujba Kids', 'Oybek', 'Oazis', 'Algoritm', 'Hamid Olimjon', 'Shaxriston', 'ZENIT LC', 'Minor',
      'School Novza', 'School Uchtepa', 'School General Uzoqov', 'School Olmazor', 'School Yunusobod',
      'Land Muqumiy', 'Land Rakat', 'Land Yunusobod', 'Land Uchtepa', 'Land Beltepa',
    ],
  },
  {
    id: 'navoiy', name: 'Navoiy',
    filials: [
      'Navoiy', 'School Navoi', 'Land Navoi',
      'Karmana', 'Konimex', 'Navbahor', 'Nurota', 'Qiziltepa', 'Tomdi', 'Uchquduq', 'Xatirchi', 'Zarafshon', 'Gazgon',
    ],
  },
  { id: 'fargona', name: "Farg'ona", filials: ['Fargona'] },
  { id: 'namangan', name: 'Namangan', filials: ['Namangan LC', 'School Namangan'] },
];

/** Filial set but not in any region above: Корпоративный, and old 2023-24 options Bitrix has deleted (no name left). */
const REGION_OTHER = { id: 'boshqa', name: "Boshqa (Korporativ, o'chirilgan filiallar)" };

module.exports = { REGIONS, REGION_OTHER };
