/**
 * Seed catalog data — the real pastry menu provided by the product owner
 * (see docs/seed-pastry-catalog.md). Kept as plain data so the seed script stays
 * declarative. Each item carries a coarse category used to file it into the taxonomy.
 */

export type SeedCategory =
  | 'Pan Dulce'
  | 'Croissants'
  | 'Cookies'
  | 'Cakes & Bars'
  | 'Savory'
  | 'Tarts';

export interface SeedPastry {
  name: string;
  description: string;
  category: SeedCategory;
}

export const PASTRIES: SeedPastry[] = [
  { name: 'Almond Croissant', description: 'Flaky, buttery croissant filled with sweet almond cream and topped with sliced almonds and a dusting of powdered sugar.', category: 'Croissants' },
  { name: 'Avanico', description: 'A fan-shaped Mexican pastry with delicate, crispy layers and a light sugar coating.', category: 'Pan Dulce' },
  { name: 'Banderilla', description: 'A twisted, stick-shaped pan dulce with a crunchy sugar topping, perfect for dipping in coffee or hot chocolate.', category: 'Pan Dulce' },
  { name: 'Barquillo', description: 'A boat-shaped sweet bread filled with cream or jam, with a soft interior and lightly glazed top.', category: 'Pan Dulce' },
  { name: 'Bolita de Queso', description: 'A small, round cheese-flavored sweet roll with a soft, pillowy texture and a subtle sweetness.', category: 'Pan Dulce' },
  { name: 'Broca', description: 'A traditional Mexican sweet bread with a rounded top and crumbly sugar shell, shaped like a paintbrush.', category: 'Pan Dulce' },
  { name: 'Butter Croissant', description: 'A classic French-style croissant with golden, flaky layers made from laminated butter dough.', category: 'Croissants' },
  { name: 'Chocolate Croissant', description: 'A buttery, flaky croissant wrapped around rich chocolate batons, baked to golden perfection.', category: 'Croissants' },
  { name: 'Chocolate Pecan Brownie', description: 'A dense, fudgy chocolate brownie loaded with toasted pecans for a rich, nutty bite.', category: 'Cakes & Bars' },
  { name: 'Churro Croissant', description: 'A creative fusion of a flaky croissant coated in cinnamon sugar, combining two beloved pastry traditions.', category: 'Croissants' },
  { name: 'Cinnamon Roll', description: 'A soft, spiraled roll swirled with cinnamon and brown sugar, topped with a sweet cream cheese glaze.', category: 'Pan Dulce' },
  { name: 'Concha con Crema Batida', description: 'The iconic Mexican shell-shaped sweet bread filled with a generous layer of fresh whipped cream.', category: 'Pan Dulce' },
  { name: 'Cookie', description: 'A freshly baked cookie with a crisp edge and chewy center, made from scratch daily.', category: 'Cookies' },
  { name: 'Cookie Butter Braid', description: 'A braided pastry filled with creamy, spiced cookie butter and baked until golden and flaky.', category: 'Pan Dulce' },
  { name: 'Cuadro de Nuez', description: 'A square-shaped Mexican pastry topped with a sweet, crunchy pecan and sugar crumble.', category: 'Cakes & Bars' },
  { name: 'Empanada', description: 'A flaky, turnover-style pastry filled with sweet fruit filling and finished with a light sugar glaze.', category: 'Pan Dulce' },
  { name: 'Ferrer Rocher Concha', description: 'A decadent twist on the classic concha, inspired by the famous hazelnut chocolate, with a rich chocolate-hazelnut topping.', category: 'Pan Dulce' },
  { name: 'Galleta de Flor', description: 'A beautiful flower-shaped shortbread cookie with a delicate, buttery crumb and sweet finish.', category: 'Cookies' },
  { name: 'Galleta de Fresa', description: 'A soft strawberry-flavored cookie with a vibrant pink hue and sweet, fruity taste.', category: 'Cookies' },
  { name: 'Ham and Cheese Croissant', description: 'A savory croissant filled with sliced ham and melted cheese, baked until bubbly and golden.', category: 'Savory' },
  { name: 'Hillo', description: 'A traditional Mexican sweet bread roll with a soft texture and a stripe of sweet filling running through the center.', category: 'Pan Dulce' },
  { name: 'Juvilete de Fruta', description: 'A fruit-topped pastry with a buttery base and a colorful arrangement of fresh or glazed fruit.', category: 'Tarts' },
  { name: 'Mariposa', description: 'A butterfly-shaped pan dulce with crispy, caramelized layers that shatter with every bite.', category: 'Pan Dulce' },
  { name: 'Mazapan Concha', description: 'A concha topped with a crumbly, sweet mazapán (peanut confection) shell for a nutty, melt-in-your-mouth twist.', category: 'Pan Dulce' },
  { name: 'Oreja', description: 'A classic ear-shaped puff pastry with crispy, caramelized sugar layers — the Mexican take on a palmier.', category: 'Pan Dulce' },
  { name: 'Oreja Azucarada', description: 'A sugar-coated version of the traditional oreja, with an extra-sweet, sparkly sugar crust.', category: 'Pan Dulce' },
  { name: 'Pastel de Guayaba', description: 'A tender pastry filled with sweet, fragrant guava paste — a beloved tropical Mexican flavor.', category: 'Pan Dulce' },
  { name: 'Pastel de Queso', description: 'A soft pastry filled with sweetened cream cheese for a rich, creamy center in every bite.', category: 'Pan Dulce' },
  { name: 'Pino', description: 'A cone or pine tree-shaped Mexican sweet bread with a colorful sugar shell and soft, fluffy interior.', category: 'Pan Dulce' },
  { name: 'Riel', description: 'A rail-shaped pan dulce with a long, ridged form, a soft crumb, and a sweet sugar topping.', category: 'Pan Dulce' },
  { name: 'Sema de Leche - Grande', description: 'A large, dome-shaped sweet roll made with a rich milk-based dough, soft and perfect for sharing.', category: 'Pan Dulce' },
  { name: 'Spinach Ricotta Croissant', description: 'A savory croissant filled with a blend of fresh spinach and creamy ricotta cheese, baked until golden.', category: 'Savory' },
  { name: 'Tarta de Fruta', description: 'A crisp pastry tart shell filled with pastry cream and topped with an assortment of fresh seasonal fruit.', category: 'Tarts' },
  { name: 'Tomato Feta Egg Bite', description: 'A savory baked egg bite with tomato and feta.', category: 'Savory' },
];

export const SEED_CATEGORIES: SeedCategory[] = [
  'Pan Dulce',
  'Croissants',
  'Cookies',
  'Cakes & Bars',
  'Savory',
  'Tarts',
];

/**
 * A small deterministic price (in cents) per item so the seed is reproducible (no
 * randomness). Prices range $1.50–$3.75 based on the item's position.
 */
export function seedPriceCents(index: number): number {
  return 150 + (index % 10) * 25;
}
