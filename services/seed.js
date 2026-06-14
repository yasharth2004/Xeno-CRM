const { readDb, writeDb } = require("./db");

const names = [
  "Aarav Mehta", "Ira Kapoor", "Kabir Rao", "Naina Shah", "Vihaan Sen", "Anika Iyer",
  "Reyansh Jain", "Meera Bose", "Advait Nair", "Sara Khan", "Arjun Reddy", "Tara Bhat",
  "Dev Malhotra", "Riya Das", "Krish Menon", "Zoya Ansari", "Neil Chandra", "Maya Pillai",
  "Yash Gupta", "Aisha Suri", "Om Verma", "Kiara Dutt", "Rohan Gill", "Myra Joshi",
  "Vivaan Basu", "Dia Grover", "Shaurya Lal", "Avni Roy", "Ishaan Walia", "Ruhi Sinha",
  "Dhruv Bedi", "Sia Mathur", "Aryan Puri", "Anaisha Kohli", "Kiaan Arora", "Misha Trivedi",
  "Pranav Vyas", "Anaya Saxena", "Lakshya Sood", "Inaya Mirza", "Rudra Hegde", "Nyra Shetty",
  "Ayaan Narang", "Vanya Chopra", "Parth Kulkarni", "Eva Thomas", "Vedant Ghosh", "Jiya Anand"
];

const cities = ["Mumbai", "Delhi", "Bengaluru", "Pune", "Hyderabad", "Chennai"];
const categories = ["sneakers", "denim", "coffee", "skincare", "activewear", "accessories"];
const channels = ["WHATSAPP", "SMS", "EMAIL", "RCS"];

function rand(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function buildSeed() {
  const customers = [];
  const orders = [];

  names.forEach((name, index) => {
    const customerId = `cus_${String(index + 1).padStart(3, "0")}`;
    const orderCount = 1 + Math.floor(rand(index + 3) * 10);
    const lastPurchaseDays = 7 + Math.floor(rand(index + 17) * 140);
    const preferredCategory = categories[index % categories.length];
    let totalSpent = 0;

    for (let orderIndex = 0; orderIndex < orderCount; orderIndex += 1) {
      const amount = Math.round(450 + rand(index * 19 + orderIndex * 7) * 8500);
      totalSpent += amount;
      orders.push({
        id: `ord_${customerId}_${orderIndex + 1}`,
        customerId,
        amount,
        category: categories[(index + orderIndex) % categories.length],
        orderDate: daysAgo(lastPurchaseDays + orderIndex * (8 + Math.floor(rand(orderIndex + index) * 22)))
      });
    }

    customers.push({
      id: customerId,
      name,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/\.$/, "")}@example.com`,
      phone: `+91${9000000000 + index * 13721}`,
      city: cities[index % cities.length],
      preferredChannel: channels[index % channels.length],
      preferredCategory,
      totalSpent,
      orderCount,
      lastOrderDate: daysAgo(lastPurchaseDays)
    });
  });

  return {
    customers,
    orders,
    campaigns: [],
    communications: [],
    events: [],
    createdAt: new Date().toISOString()
  };
}

function seed({ force = false } = {}) {
  const existing = readDb();
  if (existing && !force) return existing;
  const db = buildSeed();
  writeDb(db);
  return db;
}

if (require.main === module) {
  seed({ force: process.argv.includes("--force") });
  console.log("Seed data ready in data/db.json");
}

module.exports = { seed };
