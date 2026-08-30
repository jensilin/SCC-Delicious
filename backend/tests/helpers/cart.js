const { prisma } = require("../../src/config/prisma");

// Narrower than resetDatabase for the same reason resetCatalogue is: cart tests sign in once in
// `before`, and truncating every table would delete those users and pay for a bcrypt hash per test.
// Items are deleted before carts so the intent is explicit rather than relying on the cascade.
async function resetCarts() {
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
}

module.exports = { resetCarts };
