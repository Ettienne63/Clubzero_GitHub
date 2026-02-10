document.addEventListener("DOMContentLoaded", () => {
  const scrollNavbar = document.getElementById("scroll-navbar");

  window.addEventListener("scroll", () => {
    if (window.scrollY > 200) {
      scrollNavbar.classList.add("show");
    } else {
      scrollNavbar.classList.remove("show");
    }
  });
});

const hamburger = document.getElementById("hamburger");
const navLinks = document.querySelector("#main-navbar .nav-right");

hamburger.addEventListener("click", () => {
  navLinks.classList.toggle("show");
  hamburger.classList.toggle("active");
});

const scrollHamburger = document.getElementById("scroll-hamburger");
const scrollNavLinks = document.querySelector("#scroll-navbar .nav-right");

scrollHamburger.addEventListener("click", () => {
  scrollNavLinks.classList.toggle("show");
  scrollHamburger.classList.toggle("active");
});

const checkpoints = [
  { sales: 1 },
  { sales: 1000 },
  { sales: 5000 },
  { sales: 10000 },
];

function updateSales(currentSales) {
  const progressFill = document.getElementById("progressFill");
  const checkpointEls = document.querySelectorAll(".checkpoint-marker");
  document.getElementById("totalSales").textContent =
    "Total Sales: " + currentSales;

  let lastIndex = 0;
  checkpoints.forEach((cp, index) => {
    if (currentSales >= cp.sales) lastIndex = index;
  });

  const fillPercent = parseFloat(checkpointEls[lastIndex].style.left);
  progressFill.style.width = fillPercent + "%";

  checkpointEls.forEach((el, index) => {
    if (index <= lastIndex) el.classList.add("active");
    else el.classList.remove("active");
  });
}
