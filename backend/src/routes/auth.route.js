const { Router } = require("express");

const { login, logout, me, refresh, register } = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/authenticate.middleware");
const { validate } = require("../middleware/validate.middleware");
const { loginSchema, registerSchema } = require("../validators/auth.validator");

const router = Router();

// register and login validate their body; refresh and logout read only the cookie, and there is
// nothing in either request to validate.
router.post("/register", validate({ body: registerSchema }), register);
router.post("/login", validate({ body: loginSchema }), login);
router.post("/refresh", refresh);
router.post("/logout", logout);

// The only authenticated route in this phase. It exists because the client needs the signed-in
// user's record after exchanging a refresh cookie for a token, and it is where the access-token
// middleware is exercised end to end.
router.get("/me", authenticate, me);

module.exports = router;
