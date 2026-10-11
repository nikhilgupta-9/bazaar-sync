const express = require("express");
const {
    register,
    login,
    googleAuth,
    logout,
    me,
    forgotPassword,
    resetPassword,
    getUserProfile,
    updateUserProfile,
    changePassword,
    getPublicSecurityStatus,
} = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/security-status", getPublicSecurityStatus);
router.post("/register", register);
router.post("/login", login);
router.post("/google", googleAuth);
router.post("/logout", requireAuth, logout);
router.get("/me", requireAuth, me);
router.get("/profile", requireAuth, getUserProfile);
router.put("/profile", requireAuth, updateUserProfile);
router.put("/change-password", requireAuth, changePassword);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

module.exports = router;
