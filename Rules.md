{
  "rules": {
    
    // =========================================================
    // ADMIN ACCESS CONFIGURATION
    // (Grants full access to 'yadipvasava@gmail.com')
    // =========================================================
    "admins": {
      ".read": true,
      ".write": "auth != null && auth.token.email === 'yadipvasava@gmail.com'"
    },

    // =========================================================
    // 1. PUBLIC APP DATA (Panels, Promos, Settings)
    // Users can read, but only Admin can edit/write
    // =========================================================
    "panels": {
      ".read": "auth != null",
      ".write": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)"
    },
    "promotions": {
      ".read": "auth != null",
      ".write": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)"
    },
    "settings": {
      ".read": true,
      ".write": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)"
    },
    "deposit_settings": {
      ".read": true,
      ".write": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)"
    },
    "support_links": {
      ".read": true,
      ".write": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)"
    },

    // =========================================================
    // 2. USERS DATA (Profile & Balance)
    // User can edit their own balance during payment gateway or purchases.
    // Admin has access to all users.
    // =========================================================
    "users": {
      ".read": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)",
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)",
        ".write": "auth != null && (auth.uid === $uid || auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)"
      }
    },

    // =========================================================
    // 3. TRANSACTIONS & PURCHASES (My Keys / History)
    // Completely isolated per user.
    // =========================================================
    "transactions": {
      ".read": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)",
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)",
        ".write": "auth != null && (auth.uid === $uid || auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)"
      }
    },
    "purchases": {
      ".read": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)",
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)",
        ".write": "auth != null && (auth.uid === $uid || auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)"
      }
    },

    // =========================================================
    // 3b. ORDERS (Panel purchase orders -> Admin approves & delivers key)
    // User can only CREATE a new pending order under their own uid.
    // Only Admin can update it afterwards (approve/reject, set key & link).
    // =========================================================
    "orders": {
      ".read": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)",
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)",
        "$orderId": {
          ".write": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true || (auth.uid === $uid && !data.exists()))"
        }
      }
    },

    // =========================================================
    // 4. DEPOSIT ORDERS (FamGateway, Manual, Crypto)
    // Users create their own orders. Admins can verify/update.
    // =========================================================
    "gateway_payments": {
      ".read": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)",
      "$orderId": {
        ".read": "auth != null && (data.child('uid').val() === auth.uid || !data.exists())",
        ".write": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true || (!data.exists() && newData.child('uid').val() === auth.uid) || (data.exists() && data.child('uid').val() === auth.uid))"
      }
    },
    "manual_deposits": {
      ".read": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)",
      "$txId": {
        ".read": "auth != null && (data.child('uid').val() === auth.uid || !data.exists())",
        ".write": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true || (!data.exists() && newData.child('uid').val() === auth.uid) || (data.exists() && data.child('uid').val() === auth.uid))"
      }
    },
    "crypto_deposits": {
      ".read": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)",
      "$txId": {
        ".read": "auth != null && (data.child('uid').val() === auth.uid || !data.exists())",
        ".write": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true || (!data.exists() && newData.child('uid').val() === auth.uid) || (data.exists() && data.child('uid').val() === auth.uid))"
      }
    },

    // =========================================================
    // 5. COUPONS SYSTEM
    // Users can read coupons, and can ONLY update the 'used' count.
    // Admins have full access.
    // =========================================================
    "coupons": {
      ".read": "auth != null",
      ".write": "auth != null && (auth.token.email === 'yadipvasava@gmail.com' || root.child('admins').child(auth.uid).val() === true)",
      "$couponId": {
        "used": {
          ".write": "auth != null"
        }
      }
    }
    
  }
}
