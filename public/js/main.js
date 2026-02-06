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
