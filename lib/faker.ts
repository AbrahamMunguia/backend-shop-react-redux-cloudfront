import { faker } from "@faker-js/faker";

export function createRandomProducts() {
    return {
        userId: faker.string.uuid(),
        product: faker.commerce.product(),
        productDescription: faker.commerce.productDescription(),
        price: faker.commerce.price(),
        department: faker.commerce.department()
    };
}
export const products = faker.helpers.multiple(createRandomProducts, {
    count: 10,
});