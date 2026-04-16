import { faker } from "@faker-js/faker";

export function createRandomProducts() {
    return {
        id: faker.string.uuid(),
        title: faker.commerce.product(),
        description: faker.commerce.productDescription(),
        price: faker.commerce.price(),
        department: faker.commerce.department(),
    };
}
export const products = faker.helpers.multiple(createRandomProducts, {
    count: 10,
});
